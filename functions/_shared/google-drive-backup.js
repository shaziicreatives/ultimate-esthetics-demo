import {getConnection,decryptTokens,googleRequest} from "./google-drive.js";

const enc=new TextEncoder();
const nowParts=()=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
const dateStamp=()=>{const p=nowParts();return p.year+"-"+p.month+"-"+p.day;};
const timeStamp=()=>{const p=nowParts();return p.hour+p.minute+p.second;};
const safeRows=async(env,sql)=>{const result=await env.DB.prepare(sql).all();return result.results||[];};

async function ensureBackupFolder(env,tokens,rootId){
 const q="'"+rootId.replace(/'/g,"\\'")+"' in parents and name='Clinic Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false";
 const found=await googleRequest(env,tokens,"/drive/v3/files?"+new URLSearchParams({q,fields:"files(id,name)",pageSize:"5",supportsAllDrives:"true",includeItemsFromAllDrives:"true"}).toString());
 if(found.data.files?.[0])return found.data.files[0];
 const made=await googleRequest(env,tokens,"/drive/v3/files?supportsAllDrives=true",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Clinic Backups",mimeType:"application/vnd.google-apps.folder",parents:[rootId]})});
 return made.data;
}
async function uploadBackup(env,tokens,parent,name,bytes){
 const boundary="ue_backup_"+crypto.randomUUID().replace(/-/g,"");
 const metadata=JSON.stringify({name,mimeType:"application/json",parents:[parent]});
 const body=new Blob([
  "--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+metadata+
  "\r\n--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
  bytes,"\r\n--"+boundary+"--"
 ],{type:"multipart/related; boundary="+boundary});
 const result=await googleRequest(env,tokens,"/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink",{
  method:"POST",headers:{"Content-Type":"multipart/related; boundary="+boundary},body
 });
 return result.data;
}
async function updateBackupFile(env,tokens,fileId,bytes){
 const boundary="ue_backup_update_"+crypto.randomUUID().replace(/-/g,"");
 const body=new Blob(["--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",bytes,"\r\n--"+boundary+"--"],{type:"multipart/related; boundary="+boundary});
 const result=await googleRequest(env,tokens,"/upload/drive/v3/files/"+encodeURIComponent(fileId)+"?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink",{
  method:"PATCH",headers:{"Content-Type":"multipart/related; boundary="+boundary},body
 });
 return result.data;
}
async function buildSnapshot(env){
 const [users,doctors,patients,appointments,visits,procedures,payments,notes,tokens,counters,invoices,permissions,activity]=await Promise.all([
  safeRows(env,"SELECT id,username,email,role,doctor_id,is_active,first_name,last_name,created_at,updated_at FROM users ORDER BY id"),
  safeRows(env,"SELECT * FROM doctors ORDER BY id"),
  safeRows(env,"SELECT * FROM patients ORDER BY id"),
  safeRows(env,"SELECT * FROM appointments ORDER BY id"),
  safeRows(env,"SELECT * FROM visits ORDER BY id"),
  safeRows(env,"SELECT * FROM visit_procedures ORDER BY id"),
  safeRows(env,"SELECT * FROM payments ORDER BY id"),
  safeRows(env,"SELECT * FROM patient_notes ORDER BY id"),
  safeRows(env,"SELECT * FROM appointment_daily_tokens ORDER BY appointment_id"),
  safeRows(env,"SELECT * FROM daily_token_counters ORDER BY clinic_date"),
  safeRows(env,"SELECT * FROM invoice_sequence ORDER BY id"),
  safeRows(env,"SELECT * FROM user_permissions ORDER BY user_id,permission"),
  safeRows(env,"SELECT id,user_id,username,action,entity,entity_id,details,created_at FROM activity_log ORDER BY id")
 ]);
 const reportDate=dateStamp();
 const [dailyVisits,dailyPayments,dailyAppointments]=await Promise.all([
  env.DB.prepare("SELECT v.id visit_id,v.invoice_number,v.total_amount,v.user_id,v.created_at,p.id patient_id,p.name patient_name,u.username entered_by,u.role entered_by_role FROM visits v JOIN patients p ON p.id=v.patient_id LEFT JOIN users u ON u.id=v.user_id WHERE DATE(datetime(v.created_at,'+5 hours'))=? ORDER BY v.created_at,v.id").bind(reportDate).all(),
  env.DB.prepare("SELECT py.id payment_id,py.visit_id,py.patient_id,py.amount,py.method,py.reference,py.created_at,p.name patient_name,v.invoice_number,py.received_by,u.username received_by_username,u.role received_by_role FROM payments py JOIN patients p ON p.id=py.patient_id LEFT JOIN visits v ON v.id=py.visit_id LEFT JOIN users u ON u.id=py.received_by WHERE DATE(datetime(py.created_at,'+5 hours'))=? ORDER BY py.created_at,py.id").bind(reportDate).all(),
  env.DB.prepare("SELECT a.id appointment_id,a.patient_id,p.name patient_name,a.date,a.time,a.source,a.created_at,a.created_by,u.username entered_by,u.role entered_by_role FROM appointments a JOIN patients p ON p.id=a.patient_id LEFT JOIN users u ON u.id=a.created_by WHERE DATE(datetime(a.created_at,'+5 hours'))=? ORDER BY a.created_at,a.id").bind(reportDate).all()
 ]);
 const dailyReport={
  report_date:reportDate,timezone:"Asia/Karachi",
  unique_patients_seen:new Set((dailyVisits.results||[]).map(x=>x.patient_id)).size,
  visit_entries:(dailyVisits.results||[]).length,
  appointment_entries:(dailyAppointments.results||[]).length,
  payments_count:(dailyPayments.results||[]).length,
  payments_total:(dailyPayments.results||[]).reduce((sum,x)=>sum+Number(x.amount||0),0),
  visit_entries_detail:dailyVisits.results||[],
  appointment_entries_detail:dailyAppointments.results||[],
  payments_detail:dailyPayments.results||[]
 };
 const data={
  backup_format:"ultimate-esthetics-clinic-json-v2",
  clinic:"Ultimate Esthetics",
  created_at:new Date().toISOString(),
  timezone:"Asia/Karachi",
  daily_activity_report:dailyReport,
  security_note:"Password hashes, password salts, session tokens, OAuth tokens, API secrets, login attempts and push subscription endpoints are intentionally excluded.",
  tables:{
   users,doctors,patients,appointments,visits,visit_procedures:procedures,payments,patient_notes:notes,
   appointment_daily_tokens:tokens,daily_token_counters:counters,invoice_sequence:invoices,user_permissions:permissions,activity_log:activity
  }
 };
 const counts=Object.fromEntries(Object.entries(data.tables).map(([name,rows])=>[name,rows.length]));
 return {bytes:enc.encode(JSON.stringify(data,null,2)),counts,dailyReport};
}

export async function backupClinicToDrive(env,kind="manual"){
 let backupId=null;
 try{
  const connection=await getConnection(env);
  if(!connection?.root_folder_id)return {success:false,skipped:true,reason:"Clinic Drive folder is not selected"};
  let existingDaily=null;
  if(kind==="daily"){
   if(!connection.auto_backup_daily)return {success:true,skipped:true,reason:"Automatic backup is disabled"};
   existingDaily=await env.DB.prepare("SELECT id,status,created_at,updated_at,drive_file_id,file_name FROM google_drive_backups WHERE google_email=? AND backup_kind='daily' ORDER BY id DESC LIMIT 1").bind(connection.google_email).first();
   const lastStamp=Date.parse(String(existingDaily?.updated_at||existingDaily?.created_at||"").replace(" ","T")+"Z");
   const age=Number.isFinite(lastStamp)?Date.now()-lastStamp:Infinity;
   if(existingDaily?.status==="processing"&&age<15*60*1000)return {success:true,skipped:true,reason:"Clinic backup is already running"};
   if(existingDaily?.status==="failed"&&age<5*60*1000)return {success:true,skipped:true,reason:"Backup retry is cooling down"};
   if(existingDaily?.status==="saved"&&age<3*24*60*60*1000)return {success:true,skipped:true,reason:"Next full clinic backup is due three days after the previous backup"};
   if(existingDaily?.id){
    backupId=existingDaily.id;
    await env.DB.prepare("UPDATE google_drive_backups SET status='processing',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(backupId).run();
   }
  }
  if(!backupId){
   const stamp=dateStamp()+"_"+timeStamp();
   const fileName=kind==="daily"?"Ultimate_Esthetics_Clinic_Backup.json":"Ultimate_Esthetics_Clinic_ManualBackup_"+stamp+".json";
   const inserted=await env.DB.prepare("INSERT INTO google_drive_backups(google_email,backup_kind,backup_date,file_name,status) VALUES(?,?,?,?,'processing')").bind(connection.google_email,kind,kind==="daily"?dateStamp():new Date().toISOString(),fileName).run();
   backupId=inserted.meta.last_row_id;
  }
  const [tokens,snapshot]=await Promise.all([decryptTokens(connection.encrypted_tokens,env),buildSnapshot(env)]);
  if(snapshot.bytes.byteLength>10*1024*1024)throw new Error("Clinic data backup is larger than 10 MB. Use the per-patient Drive records and contact the developer for a large export.");
  const folder=await ensureBackupFolder(env,tokens,connection.root_folder_id);
  const row=await env.DB.prepare("SELECT file_name FROM google_drive_backups WHERE id=?").bind(backupId).first();
  const saved=await uploadBackup(env,tokens,folder.id,row.file_name,snapshot.bytes);
  let dailyReportFile=null;
  if(kind==="daily"){
   const reportBytes=enc.encode(JSON.stringify(snapshot.dailyReport,null,2));
   dailyReportFile=await uploadBackup(env,tokens,folder.id,"Daily_Activity_"+dateStamp()+".json",reportBytes);
  }
  await env.DB.prepare("UPDATE google_drive_backups SET drive_file_id=?,web_view_link=?,size_bytes=?,status='saved',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(saved.id,saved.webViewLink||null,snapshot.bytes.byteLength,backupId).run();
  return {success:true,backup_id:backupId,file_name:row.file_name,web_view_link:saved.webViewLink||existingDaily?.web_view_link||null,daily_report:snapshot.dailyReport,size_bytes:snapshot.bytes.byteLength,counts:snapshot.counts,next_backup_due_in_days:kind==="daily"?3:undefined};
 }catch(error){
  if(backupId)await env.DB.prepare("UPDATE google_drive_backups SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(String(error?.message||"Clinic backup failed").slice(0,500),backupId).run().catch(()=>{});
  return {success:false,backup_id:backupId,error:String(error?.message||"Clinic backup failed")};
 }
}
