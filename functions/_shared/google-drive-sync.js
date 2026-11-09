import {getConnection,decryptTokens,googleRequest} from "./google-drive.js";

const enc=new TextEncoder();
const jsonBytes=value=>enc.encode(JSON.stringify(value,null,2));
const clean=value=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();
const pdfEscape=value=>clean(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");

function makePdf(lines){
 const rows=lines.flatMap(line=>{
  const value=clean(line)||" ";
  const out=[];
  for(let i=0;i<value.length;i+=88)out.push(value.slice(i,i+88));
  return out;
 });
 const pages=[];
 for(let i=0;i<rows.length;i+=48)pages.push(rows.slice(i,i+48));
 if(!pages.length)pages.push(["Ultimate Esthetics Clinic"]);
 const objects=[];
 const pageRefs=pages.map((_,i)=>3+i*2);
 const fontRef=3+pages.length*2;
 objects.push("<< /Type /Catalog /Pages 2 0 R >>");
 objects.push("<< /Type /Pages /Kids ["+pageRefs.map(n=>n+" 0 R").join(" ")+"] /Count "+pages.length+" >>");
 for(let i=0;i<pages.length;i++){
  const pageRef=pageRefs[i], streamRef=pageRef+1;
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 "+fontRef+" 0 R >> >> /Contents "+streamRef+" 0 R >>");
  const commands=["BT","/F1 11 Tf","50 790 Td","15 TL",...pages[i].map((line,index)=>(index?"T* ":"")+"("+pdfEscape(line)+") Tj"),"ET"].join("\n");
  const length=enc.encode(commands).length;
  objects.push("<< /Length "+length+" >>\nstream\n"+commands+"\nendstream");
 }
 objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
 const chunks=[enc.encode("%PDF-1.4\n")],offsets=[0];let size=chunks[0].length;
 objects.forEach((object,index)=>{
  offsets.push(size);
  const start=enc.encode((index+1)+" 0 obj\n"),body=enc.encode(object),end=enc.encode("\nendobj\n");
  chunks.push(start,body,end);size+=start.length+body.length+end.length;
 });
 const xrefOffset=size;
 const xref="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n"+
  offsets.slice(1).map(value=>String(value).padStart(10,"0")+" 00000 n \n").join("")+
  "trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xrefOffset+"\n%%EOF";
 chunks.push(enc.encode(xref));
 const total=chunks.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(total);let offset=0;
 for(const part of chunks){out.set(part,offset);offset+=part.length;}
 return out;
}

async function api(env,tokens,path,options){return googleRequest(env,tokens,path,options);}
async function findFolder(env,tokens,parent,name){
 const q="'"+parent.replace(/'/g,"\\'")+"' in parents and name='"+name.replace(/'/g,"\\'")+"' and mimeType='application/vnd.google-apps.folder' and trashed=false";
 const r=await api(env,tokens,"/drive/v3/files?"+new URLSearchParams({q,fields:"files(id,name)",pageSize:"10",supportsAllDrives:"true",includeItemsFromAllDrives:"true"}).toString());
 return r.data.files?.[0]||null;
}
async function ensureFolder(env,tokens,parent,name){
 const found=await findFolder(env,tokens,parent,name);if(found)return found;
 const r=await api(env,tokens,"/drive/v3/files?supportsAllDrives=true",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,mimeType:"application/vnd.google-apps.folder",parents:[parent]})});
 return r.data;
}
async function upload(env,tokens,parent,name,mime,bytes,existingId){
 const boundary="ue_"+crypto.randomUUID().replace(/-/g,"");
 let moveQuery="";
 if(existingId){
  const current=await api(env,tokens,"/drive/v3/files/"+encodeURIComponent(existingId)+"?fields=id,parents,trashed&supportsAllDrives=true");
  if(current.data.trashed)throw new Error("Google Drive API 404: file was trashed; a new copy will be created.");
  const parents=current.data.parents||[];
  if(!parents.includes(parent)){
   moveQuery="&addParents="+encodeURIComponent(parent);
   if(parents.length)moveQuery+="&removeParents="+encodeURIComponent(parents.join(","));
  }
 }
 const meta=JSON.stringify({name,mimeType:mime,...(existingId?{}:{parents:[parent]})});
 const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+"\r\n--"+boundary+"\r\nContent-Type: "+mime+"\r\n\r\n",bytes,"\r\n--"+boundary+"--"],{type:"multipart/related; boundary="+boundary});
 const base="/upload/drive/v3/files"+(existingId?"/"+encodeURIComponent(existingId):"");
 const path=base+"?uploadType=multipart&fields=id,name,mimeType,webViewLink&supportsAllDrives=true"+moveQuery;
 const result=await api(env,tokens,path,{method:existingId?"PATCH":"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body});
 return result.data;
}
async function storeFile(env,tokens,googleEmail,patientId,visitId,kind,parent,name,mime,bytes){
 const old=await env.DB.prepare("SELECT drive_file_id FROM google_drive_files WHERE google_email=? AND patient_id=? AND visit_id IS ? AND file_kind=? ORDER BY id DESC LIMIT 1").bind(googleEmail,patientId,visitId,kind).first();
 let saved;
 try{saved=await upload(env,tokens,parent,name,mime,bytes,old?.drive_file_id||null);}
 catch(error){
  const message=String(error?.message||"");
  if(!old?.drive_file_id||!/(?:400|403|404)|trashed|cannot be moved/i.test(message))throw error;
  // If a previous file is trashed or cannot be moved between Drive locations,
  // create a fresh copy in the currently selected clinic folder.
  saved=await upload(env,tokens,parent,name,mime,bytes,null);
 }
 await env.DB.prepare("INSERT INTO google_drive_files(patient_id,visit_id,file_kind,drive_file_id,file_name,mime_type,web_view_link,google_email,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(drive_file_id) DO UPDATE SET file_name=excluded.file_name,mime_type=excluded.mime_type,web_view_link=excluded.web_view_link,google_email=excluded.google_email,updated_at=CURRENT_TIMESTAMP")
  .bind(patientId,visitId,kind,saved.id,name,mime,saved.webViewLink||null,googleEmail).run();
 return saved;
}
async function invoiceCollection(env,tokens,connection){
 return ensureFolder(env,tokens,connection.root_folder_id,"Patients (Overall)");
}
async function patientRecord(env,patientId){
 const patient=await env.DB.prepare("SELECT p.*,r.name referred_by_name FROM patients p LEFT JOIN patients r ON r.id=p.referred_by_patient_id WHERE p.id=?").bind(patientId).first();
 if(!patient)return null;
 const [notes,appointments,visits]=await Promise.all([
  env.DB.prepare("SELECT note,created_at FROM patient_notes WHERE patient_id=? ORDER BY created_at,id").bind(patientId).all(),
  env.DB.prepare("SELECT a.id,a.date,a.time,a.treatment,a.status,a.checked_in_at,a.follow_up_date,dt.clinic_date,dt.token,d.name doctor FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id LEFT JOIN appointment_daily_tokens dt ON dt.appointment_id=a.id WHERE a.patient_id=? ORDER BY a.date DESC,a.time DESC").bind(patientId).all(),
  env.DB.prepare("SELECT v.id,v.invoice_number,v.total_amount,v.subtotal_amount,v.discount_amount,v.follow_up_date,v.created_at,COALESCE((SELECT SUM(amount) FROM payments py WHERE py.visit_id=v.id),0) paid FROM visits v WHERE v.patient_id=? ORDER BY v.created_at DESC").bind(patientId).all()
 ]);
 return {
  clinic:"Ultimate Esthetics",patient_id:patient.id,name:patient.name,phone:patient.phone,
  referred_by_patient_id:patient.referred_by_patient_id,referred_by_name:patient.referred_by_name,
  referral_notes:patient.referral_notes,created_at:patient.created_at,updated_at:patient.updated_at,
  notes:notes.results||[],appointments:appointments.results||[],visits:visits.results||[]
 };
}
async function markJob(env,jobId,status,error=null){
 await env.DB.prepare("UPDATE google_drive_sync_jobs SET status=?,attempts=attempts+1,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
  .bind(status,error?String(error.message||error).slice(0,500):null,jobId).run();
}
async function loadTokens(env,connection){return decryptTokens(connection.encrypted_tokens,env);}

export async function syncPatientToDrive(env,patientId){
 // Patient profile/history files are intentionally not exported to Drive.
 // The shared Patients (Overall) folder contains invoice PDFs only.
 return {success:true,skipped:true,reason:"Only invoice PDFs are stored in the shared Patients (Overall) folder."};
}

export async function syncVisitToDrive(env,visitId){
 let job=null;
 try{
  const connection=await getConnection(env);if(!connection?.root_folder_id)return {success:false,skipped:true,reason:"Drive folder is not configured"};
  const visit=await env.DB.prepare("SELECT v.*,p.name patient_name,p.phone patient_phone,d.name doctor_name,a.date visit_date FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN doctors d ON d.id=v.doctor_id LEFT JOIN appointments a ON a.id=v.appointment_id WHERE v.id=?").bind(visitId).first();
  if(!visit)return {success:false,skipped:true,reason:"Visit not found"};
  await env.DB.prepare("INSERT INTO google_drive_sync_jobs(patient_id,visit_id,job_kind,status) VALUES(?,?,'visit','processing') ON CONFLICT(job_kind,visit_id,patient_id) DO UPDATE SET status='processing',last_error=NULL,updated_at=CURRENT_TIMESTAMP")
   .bind(visit.patient_id,visit.id).run();
  job=await env.DB.prepare("SELECT id FROM google_drive_sync_jobs WHERE job_kind='visit' AND visit_id=? AND patient_id=?").bind(visit.id,visit.patient_id).first();
  const tokens=await loadTokens(env,connection);
  const patient={id:visit.patient_id,name:visit.patient_name,phone:visit.patient_phone};
  const folder=await invoiceCollection(env,tokens,connection);
  const [procedures,payments]=await Promise.all([
   env.DB.prepare("SELECT procedure_name,fee FROM visit_procedures WHERE visit_id=? ORDER BY id").bind(visit.id).all(),
   env.DB.prepare("SELECT amount,method,reference,created_at FROM payments WHERE visit_id=? ORDER BY created_at,id").bind(visit.id).all()
  ]);
  if(connection.auto_save_invoice_pdf){
   const lines=["ULTIMATE ESTHETICS CLINIC","PATIENT INVOICE","Invoice: "+(visit.invoice_number||"—"),"Patient: "+patient.name+"  Patient ID: "+patient.id,"Phone: "+patient.phone,"Visit date: "+(visit.visit_date||visit.created_at||"—"),"Doctor: "+(visit.doctor_name||"—"),"","Treatment / Services:"];
   (procedures.results||[]).forEach(p=>lines.push(p.procedure_name+" - Rs "+Number(p.fee||0).toLocaleString("en-PK")));
   lines.push("","Subtotal: Rs "+Number(visit.subtotal_amount??visit.total_amount??0).toLocaleString("en-PK"),
    "Discount: Rs "+Number(visit.discount_amount||0).toLocaleString("en-PK"),
    "Total: Rs "+Number(visit.total_amount||0).toLocaleString("en-PK"));
   (payments.results||[]).forEach(p=>lines.push("Payment: Rs "+Number(p.amount||0).toLocaleString("en-PK")+" ("+p.method+")"));
   lines.push("","Notes: "+(visit.notes||"—"),"Follow-up: "+(visit.follow_up_date||"—"));
   const invoiceLabel=clean(visit.invoice_number||("Visit-"+visit.id)).replace(/[^A-Za-z0-9_-]+/g,"_");
   const patientLabel=clean(patient.name).replace(/[^A-Za-z0-9_-]+/g,"_").slice(0,50);
   await storeFile(env,tokens,connection.google_email,patient.id,visit.id,"invoice_pdf",folder.id,patientLabel+"_"+invoiceLabel+".pdf","application/pdf",makePdf(lines));
  }
  await markJob(env,job.id,"saved");
  await env.DB.prepare("UPDATE google_drive_connections SET last_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
  return {success:true};
 }catch(error){
  if(job?.id)await markJob(env,job.id,"failed",error).catch(()=>{});
  return {success:false,error:String(error?.message||"Drive sync failed")};
 }
}
