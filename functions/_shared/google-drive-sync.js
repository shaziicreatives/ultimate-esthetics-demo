import {getConnection,decryptTokens,googleRequest} from "./google-drive.js";
const enc=new TextEncoder();
const jsonBytes=value=>enc.encode(JSON.stringify(value,null,2));
const clean=value=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();
const pdfEscape=value=>clean(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
function makePdf(lines){
 const rows=lines.flatMap(line=>{const s=clean(line);const out=[];for(let i=0;i<s.length;i+=88)out.push(s.slice(i,i+88));return out;}).slice(0,48);
 const commands=["BT","/F1 11 Tf","50 790 Td","15 TL",...rows.map((line,i)=>(i?"T* ":"")+"("+pdfEscape(line)+") Tj"),"ET"].join("\n");
 const stream=enc.encode(commands),objects=[
  enc.encode("<< /Type /Catalog /Pages 2 0 R >>"),
  enc.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  enc.encode("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
  enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  enc.encode("<< /Length "+stream.length+" >>\nstream\n"+commands+"\nendstream")
 ];
 const chunks=[enc.encode("%PDF-1.4\n")],offsets=[0];let size=chunks[0].length;
 objects.forEach((obj,i)=>{offsets.push(size);const part=enc.encode((i+1)+" 0 obj\n"),end=enc.encode("\nendobj\n");chunks.push(part,obj,end);size+=part.length+obj.length+end.length;});
 const xrefOffset=size,xref="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xrefOffset+"\n%%EOF";
 chunks.push(enc.encode(xref));
 const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;
}
async function api(env,tokens,path,options){return googleRequest(env,tokens,path,options);}
async function findFolder(env,tokens,parent,name){
 const q="'"+parent.replace(/'/g,"\\'")+"' in parents and name='"+name.replace(/'/g,"\\'")+"' and mimeType='application/vnd.google-apps.folder' and trashed=false";
 const r=await api(env,tokens,"/drive/v3/files?"+new URLSearchParams({q,fields:"files(id,name)",pageSize:"10"}).toString());
 return r.data.files?.[0]||null;
}
async function ensureFolder(env,tokens,parent,name){
 const found=await findFolder(env,tokens,parent,name);if(found)return found;
 const r=await api(env,tokens,"/drive/v3/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",parents:[parent]})});
 return r.data;
}
async function upload(env,tokens,parent,name,mime,bytes,existingId){
 const boundary="ue_"+crypto.randomUUID().replace(/-/g,"");
 const meta=JSON.stringify({name, mimeType:mime,...(existingId?{}:{parents:[parent]})});
 const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+"\r\n--"+boundary+"\r\nContent-Type: "+mime+"\r\n\r\n",bytes,"\r\n--"+boundary+"--"],{type:"multipart/related; boundary="+boundary});
 const path=existingId?"/upload/drive/v3/files/"+encodeURIComponent(existingId)+"?uploadType=multipart&fields=id,name,mimeType,webViewLink":"/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink";
 const r=await api(env,tokens,path,{method:existingId?"PATCH":"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});
 return r.data;
}
async function storeFile(env,tokens,patientId,visitId,kind,parent,name,mime,bytes){
 const old=await env.DB.prepare("SELECT id,drive_file_id FROM google_drive_files WHERE patient_id=? AND visit_id IS ? AND file_kind=?").bind(patientId,visitId,kind).first();
 const saved=await upload(env,tokens,parent,name,mime,bytes,old?.drive_file_id||null);
 await env.DB.prepare("INSERT INTO google_drive_files(patient_id,visit_id,file_kind,drive_file_id,file_name,mime_type,web_view_link,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(drive_file_id) DO UPDATE SET file_name=excluded.file_name,mime_type=excluded.mime_type,web_view_link=excluded.web_view_link,updated_at=CURRENT_TIMESTAMP").bind(patientId,visitId,kind,saved.id,name,mime,saved.webViewLink||null).run();
 return saved;
}
async function patientFolder(env,tokens,connection,patient){
 const old=await env.DB.prepare("SELECT folder_id,folder_name FROM google_drive_patient_folders WHERE patient_id=?").bind(patient.id).first();
 if(old){try{const f=await api(env,tokens,"/drive/v3/files/"+encodeURIComponent(old.folder_id)+"?fields=id,name,trashed");if(!f.data.trashed)return {id:f.data.id,name:f.data.name};}catch(e){}}
 const folder=await ensureFolder(env,tokens,connection.root_folder_id,"Patients");
 const made=await ensureFolder(env,tokens,folder.id,clean(patient.name)+" - Patient "+patient.id);
 await env.DB.prepare("INSERT INTO google_drive_patient_folders(patient_id,folder_id,folder_name,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(patient_id) DO UPDATE SET folder_id=excluded.folder_id,folder_name=excluded.folder_name,updated_at=CURRENT_TIMESTAMP").bind(patient.id,made.id,made.name).run();
 return made;
}
async function visitFolder(env,tokens,patientFolder,visit){
 const old=await env.DB.prepare("SELECT folder_id,folder_name FROM google_drive_visit_folders WHERE visit_id=?").bind(visit.id).first();
 if(old){try{const f=await api(env,tokens,"/drive/v3/files/"+encodeURIComponent(old.folder_id)+"?fields=id,name,trashed");if(!f.data.trashed)return {id:f.data.id,name:f.data.name};}catch(e){}}
 const visits=await ensureFolder(env,tokens,patientFolder.id,"Visits");
 const date=String(visit.visit_date||visit.created_at||"").slice(0,10)||"Undated";
 const name="Visit "+visit.id+" - "+date+" - "+(visit.invoice_number||"Invoice");
 const made=await ensureFolder(env,tokens,visits.id,name);
 await env.DB.prepare("INSERT INTO google_drive_visit_folders(visit_id,patient_id,folder_id,folder_name,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(visit_id) DO UPDATE SET folder_id=excluded.folder_id,folder_name=excluded.folder_name,updated_at=CURRENT_TIMESTAMP").bind(visit.id,visit.patient_id,made.id,made.name).run();
 return made;
}
export async function syncVisitToDrive(env,visitId){
 let job=null;
 try{
  const connection=await getConnection(env);if(!connection?.root_folder_id)return;\n  const visit=await env.DB.prepare("SELECT v.*,p.name patient_name,p.phone patient_phone,d.name doctor_name,a.date visit_date FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN doctors d ON d.id=v.doctor_id LEFT JOIN appointments a ON a.id=v.appointment_id WHERE v.id=?").bind(visitId).first();
  if(!visit)return;
  await env.DB.prepare("INSERT INTO google_drive_sync_jobs(patient_id,visit_id,job_kind,status) VALUES(?,?,'visit','processing') ON CONFLICT(job_kind,visit_id,patient_id) DO UPDATE SET status='processing',last_error=NULL,updated_at=CURRENT_TIMESTAMP").bind(visit.patient_id,visit.id).run();
  job=await env.DB.prepare("SELECT id FROM google_drive_sync_jobs WHERE job_kind='visit' AND visit_id=? AND patient_id=?").bind(visit.id,visit.patient_id).first();
  const connection=await getConnection(env);if(!connection?.root_folder_id)throw new Error("Google Drive is not connected or the clinic root folder has not been selected.");
  const tokens=await decryptTokens(connection.encrypted_tokens,env);
  const patient={id:visit.patient_id,name:visit.patient_name,phone:visit.patient_phone};
  const folder=await patientFolder(env,tokens,connection,patient);
  const visitFolderInfo=await visitFolder(env,tokens,folder,visit);
  const procedures=await env.DB.prepare("SELECT procedure_name,fee FROM visit_procedures WHERE visit_id=? ORDER BY id").bind(visit.id).all();
  const payments=await env.DB.prepare("SELECT amount,method,reference,created_at FROM payments WHERE visit_id=? ORDER BY created_at,id").bind(visit.id).all();
  const patientRecord={patient_id:patient.id,name:patient.name,phone:patient.phone,created_at:visit.created_at,clinic:"Ultimate Esthetics"};
  const visitRecord={visit_id:visit.id,patient_id:visit.patient_id,invoice_number:visit.invoice_number,visit_date:visit.visit_date||visit.created_at,doctor:visit.doctor_name,notes:visit.notes,procedures:procedures.results||[],subtotal_amount:visit.subtotal_amount,discount_type:visit.discount_type,discount_value:visit.discount_value,discount_amount:visit.discount_amount,total_amount:visit.total_amount,payments:payments.results||[],follow_up_date:visit.follow_up_date};
  if(connection.auto_save_patient_record)await storeFile(env,tokens,patient.id,null,"patient_record_json",folder.id,"Patient Record.json","application/json",jsonBytes(patientRecord));
  if(connection.auto_save_visit_record)await storeFile(env,tokens,patient.id,visit.id,"visit_record_json",visitFolderInfo.id,"Visit Record.json","application/json",jsonBytes(visitRecord));
  if(connection.auto_save_invoice_pdf){
   const lines=["ULTIMATE ESTHETICS CLINIC","PATIENT INVOICE","Invoice: "+(visit.invoice_number||"—"),"Patient: "+patient.name+"  Patient ID: "+patient.id,"Phone: "+patient.phone,"Visit date: "+(visit.visit_date||visit.created_at||"—"),"Doctor: "+(visit.doctor_name||"—"),"","Treatment / Services:"];
   (procedures.results||[]).forEach(p=>lines.push(p.procedure_name+" - Rs "+Number(p.fee||0).toLocaleString("en-PK")));
   lines.push("","Subtotal: Rs "+Number(visit.subtotal_amount||visit.total_amount||0).toLocaleString("en-PK"),"Discount: Rs "+Number(visit.discount_amount||0).toLocaleString("en-PK"),"Total: Rs "+Number(visit.total_amount||0).toLocaleString("en-PK"));
   (payments.results||[]).forEach(p=>lines.push("Payment: Rs "+Number(p.amount||0).toLocaleString("en-PK")+" ("+p.method+")"));
   lines.push("","Notes: "+(visit.notes||"—"),"Follow-up: "+(visit.follow_up_date||"—"));
   await storeFile(env,tokens,patient.id,visit.id,"invoice_pdf",visitFolderInfo.id,"Invoice.pdf","application/pdf",makePdf(lines));
  }
  await env.DB.prepare("UPDATE google_drive_sync_jobs SET status='saved',attempts=attempts+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();
  await env.DB.prepare("UPDATE google_drive_connections SET last_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
 }catch(error){
  if(job?.id)await env.DB.prepare("UPDATE google_drive_sync_jobs SET status='failed',attempts=attempts+1,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(error?.message||"Drive sync failed").slice(0,500),job.id).run().catch(()=>{});
 }
}
