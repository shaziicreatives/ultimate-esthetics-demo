import {getConnection,decryptTokens,googleRequest} from "./google-drive.js";

const enc=new TextEncoder();
const jsonBytes=value=>enc.encode(JSON.stringify(value,null,2));
const clean=value=>String(value??"").normalize("NFKD").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();
const pdfEscape=value=>clean(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");

function makeInvoicePdf(data){
 const W=595,H=842,ops=[];
 const esc=value=>pdfEscape(value);
 const money=value=>"Rs "+Number(value||0).toLocaleString("en-PK");
 const pdfColor=hex=>{const h=String(hex||"#000000").replace("#","");return [0,2,4].map(i=>(parseInt(h.slice(i,i+2),16)/255).toFixed(3)).join(" ");};
 const rect=(x,y,w,h,color)=>ops.push(pdfColor(color)+" rg "+x+" "+y+" "+w+" "+h+" re f");
 const line=(x1,y1,x2,y2,color="#E8D4B8",width=1)=>ops.push(pdfColor(color)+" RG "+width+" w "+x1+" "+y1+" m "+x2+" "+y2+" l S");
 const txt=(x,y,value,size=10,color="#24180E",font="F1")=>ops.push(pdfColor(color)+" rg BT /"+font+" "+size+" Tf "+x+" "+y+" Td ("+esc(value)+") Tj ET");
 const wrap=(value,max=74)=>{const words=String(value??"").split(/\s+/),out=[];let row="";for(const word of words){if((row+" "+word).trim().length>max&&row){out.push(row);row=word;}else row=(row+" "+word).trim();}if(row)out.push(row);return out;};
 const dark="#4B3016",gold="#D6A85F",cream="#FFF5E6",ink="#24180E",muted="#6F6254";
 rect(0,0,W,H,"#FFFCF7");rect(0,744,W,98,cream);rect(24,744,4,80,gold);
 txt(42,802,"ULTIMATE ESTHETICS",25,dark,"F2");
 // Gold botanical clinic mark and divider echo the supplied invoice header.
 ops.push(pdfColor(gold)+" RG 3 w 48 758 m 24 780 25 814 48 831 c 68 813 75 787 60 765 c S");
 ops.push(pdfColor("#6B481F")+" RG 2 w 38 766 m 48 790 61 802 69 812 c S");
 txt(42,781,"Skin, Hair & Body Clinic",12,ink);
 txt(42,761,"Al-ain Arcade, Old Airport Road, Rawalpindi 46000",9,muted);
 txt(42,747,"0334 0005909  |  Mon to Sat, 11:00 AM - 08:00 PM",8,muted);
 rect(408,774,163,52,dark);txt(435,801,"INVOICE",21,"#FFFFFF","F2");
 txt(420,782,String(data.invoice_number||"INVOICE"),10,"#FFFFFF");
 rect(408,731,163,34,"#F8EBD8");txt(420,750,"Date: "+(data.date||"—"),9,ink);txt(420,738,"Time: "+(data.time||"—"),8,muted);
 let y=710;
 const section=(label)=>{rect(24,y-5,547,24,dark);txt(38,y+3,label,12,"#FFFFFF","F2");y-=34;};
 section("PATIENT DETAILS");
 txt(34,y,"Name: "+(data.patient_name||"—"),10);txt(310,y,"Patient ID: "+(data.patient_id??"—"),10);y-=19;
 txt(34,y,"Phone: "+(data.patient_phone||"—"),10);txt(310,y,"Doctor: "+(data.doctor_name||"—"),10);y-=17;
 txt(34,y,"Appointment: "+(data.date||"—")+"  "+(data.time||"—"),9,muted);y-=20;
 section("TREATMENT / PROCEDURES");
 rect(24,y-4,547,21,"#F8EBD8");txt(34,y+3,"#",9,dark);txt(62,y+3,"Procedure",9,dark);txt(430,y+3,"Unit Price (Rs)",9,dark);txt(520,y+3,"Total (Rs)",9,dark);y-=20;
 const procs=(data.procedures||[]).slice(0,8);
 for(let i=0;i<procs.length;i++){
  const p=procs[i],fee=Number(p.fee||0);
  txt(34,y,String(i+1),9);txt(62,y,wrap(p.procedure_name||"Treatment",48)[0],9);txt(448,y,fee.toLocaleString("en-PK"),9);txt(528,y,fee.toLocaleString("en-PK"),9);
  line(24,y-6,571,y-6);y-=20;
 }
 y-=6;txt(350,y,"Total Treatment Amount:",10,dark,"F2");txt(510,y,money(data.subtotal_amount??data.total_amount),10,dark,"F2");y-=30;
 section("PRESCRIPTION");
 const notes=wrap(data.notes||"No prescription recorded",95);
 for(const row of notes.slice(0,2)){txt(34,y,row,9,ink);y-=14;}
 y-=5;section("NOTES");
 const extraNotes=wrap(data.extra_notes||"No additional notes",95);
 for(const row of extraNotes.slice(0,2)){txt(34,y,row,9,ink);y-=14;}
 if(data.follow_up_date){y-=3;txt(34,y,"Follow-up date: "+data.follow_up_date,9,muted);y-=18;}
 y-=8;
 section("PAYMENT DETAILS");
 txt(34,y,"Previous Balance:",10);txt(200,y,money(data.previous_balance),10);txt(310,y,"Total Amount:",10);txt(475,y,money(data.total_amount),10);y-=21;
 txt(34,y,"Amount Received:",10);txt(200,y,money(data.paid_amount),10);txt(310,y,"Payment Method:",10);txt(430,y,(data.payment_methods||"—").slice(0,22),9);y-=24;
 rect(24,y-7,547,30,"#EEF2D8");txt(38,y+4,"REMAINING BALANCE",11,"#21451D","F2");txt(460,y+2,money(data.remaining_balance),14,"#21451D","F2");
 y-=57;
 if(data.payment_entries?.length){txt(34,y,"Payment entries:",9,dark,"F2");y-=15;for(const p of data.payment_entries.slice(0,3)){txt(40,y,money(p.amount)+"  "+(p.method||"")+"  "+(p.received_by||"Staff"),8,muted);y-=12;}}
 line(24,74,571,74,gold,1.2);txt(128,54,"Thank you for choosing Ultimate Esthetics.",13,dark,"F2");
 txt(40,28,"Al-ain Arcade, Old Airport Road, Rawalpindi 46000",8,muted);txt(430,28,"0334 0005909",8,muted);
 const stream=ops.join("\n"),bytes=enc.encode(stream);
 const objects=[
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  "<< /Length "+bytes.length+" >>\nstream\n"+stream+"\nendstream"
 ];
 const chunks=[enc.encode("%PDF-1.4\n")],offsets=[0];let size=chunks[0].length;
 objects.forEach((obj,i)=>{offsets.push(size);const a=enc.encode((i+1)+" 0 obj\n"),b=enc.encode(obj),c=enc.encode("\nendobj\n");chunks.push(a,b,c);size+=a.length+b.length+c.length;});
 const xrefOffset=size,xref="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xrefOffset+"\n%%EOF";
 chunks.push(enc.encode(xref));const total=chunks.reduce((n,b)=>n+b.length,0),out=new Uint8Array(total);let pos=0;for(const part of chunks){out.set(part,pos);pos+=part.length;}return out;
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
  const visit=await env.DB.prepare("SELECT v.*,p.name patient_name,p.phone patient_phone,d.name doctor_name,a.date visit_date,a.time visit_time FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN doctors d ON d.id=v.doctor_id LEFT JOIN appointments a ON a.id=v.appointment_id WHERE v.id=?").bind(visitId).first();
  if(!visit)return {success:false,skipped:true,reason:"Visit not found"};
  await env.DB.prepare("INSERT INTO google_drive_sync_jobs(patient_id,visit_id,job_kind,status) VALUES(?,?,'visit','processing') ON CONFLICT(job_kind,visit_id,patient_id) DO UPDATE SET status='processing',last_error=NULL,updated_at=CURRENT_TIMESTAMP")
   .bind(visit.patient_id,visit.id).run();
  job=await env.DB.prepare("SELECT id FROM google_drive_sync_jobs WHERE job_kind='visit' AND visit_id=? AND patient_id=?").bind(visit.id,visit.patient_id).first();
  const tokens=await loadTokens(env,connection);
  const patient={id:visit.patient_id,name:visit.patient_name,phone:visit.patient_phone};
  const folder=await invoiceCollection(env,tokens,connection);
  const [procedures,payments,previous]=await Promise.all([
   env.DB.prepare("SELECT procedure_name,fee FROM visit_procedures WHERE visit_id=? ORDER BY id").bind(visit.id).all(),
   env.DB.prepare("SELECT py.amount,py.method,py.reference,py.created_at,u.username received_by FROM payments py LEFT JOIN users u ON u.id=py.received_by WHERE py.visit_id=? ORDER BY py.created_at,py.id").bind(visit.id).all(),
   env.DB.prepare("SELECT COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=? AND id<>?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=? AND (visit_id IS NULL OR visit_id<>?)),0) balance").bind(visit.patient_id,visit.id,visit.patient_id,visit.id).first()
  ]);
  {
   const paymentRows=payments.results||[];
   const paidAmount=paymentRows.reduce((sum,p)=>sum+Number(p.amount||0),0);
   const previousBalance=Math.max(0,Number(previous?.balance||0));
   const invoiceTotal=Number(visit.total_amount||0);
   const data={
    invoice_number:visit.invoice_number||("Visit-"+visit.id),
    patient_name:patient.name,patient_id:patient.id,patient_phone:patient.phone,
    doctor_name:visit.doctor_name||"—",
    date:visit.visit_date||String(visit.created_at||"").slice(0,10),
    time:visit.visit_time||String(visit.created_at||"").slice(11,16),
    procedures:procedures.results||[],
    subtotal_amount:Number(visit.subtotal_amount??invoiceTotal),
    total_amount:invoiceTotal,previous_balance:previousBalance,
    paid_amount:paidAmount,remaining_balance:Math.max(0,previousBalance+invoiceTotal-paidAmount),
    payment_methods:[...new Set(paymentRows.map(p=>p.method).filter(Boolean))].join(", ")||"—",
    payment_entries:paymentRows,
    notes:String(visit.notes||"").split("\n\nAdditional notes:\n")[0],
    extra_notes:String(visit.notes||"").includes("\n\nAdditional notes:\n")?String(visit.notes).split("\n\nAdditional notes:\n").slice(1).join("\n\nAdditional notes:\n"):"",
    follow_up_date:visit.follow_up_date||""
   };
   const invoiceLabel=clean(data.invoice_number).replace(/[^A-Za-z0-9_-]+/g,"_");
   const phoneLabel=String(patient.phone||"").replace(/\D/g,"")||("Patient-"+patient.id);
   await storeFile(env,tokens,connection.google_email,patient.id,visit.id,"invoice_pdf",folder.id,phoneLabel+"_"+invoiceLabel+".pdf","application/pdf",makeInvoicePdf(data));
  }
  await markJob(env,job.id,"saved");
  await env.DB.prepare("UPDATE google_drive_connections SET last_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
  return {success:true};
 }catch(error){
  if(job?.id)await markJob(env,job.id,"failed",error).catch(()=>{});
  return {success:false,error:String(error?.message||"Drive sync failed")};
 }
}
