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
async function buildSnapshot(env){
 const [users,doctors,patients,appointments,visits,procedures,payments,notes,tokens,counters,invoices,permissions]=await Promise.all([
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
  safeRows(env,"SELECT * FROM user_permissions ORDER BY user_id,permission")
 ]);
 const data={
  backup_format:"ultimate-esthetics-clinic-json-v1",
  clinic:"Ultimate Esthetics",
  created_at:new Date().toISOString(),
  timezone:"Asia/Karachi",
  security_note:"Password hashes, password salts, session tokens, OAuth tokens, API secrets, login attempts and push subscription endpoints are intentionally excluded.",
  tables:{
   users,doctors,patients,appointments,visits,visit_procedures:procedures,payments,patient_notes:notes,
   appointment_daily_tokens:tokens,daily_token_counters:counters,invoice_sequence:invoices,user_permissions:permissions
  }
 };
 const counts=Object.fromEntries(Object.entries(data.tables).map(([name,rows])=>[name,rows.length]));
 return {bytes:enc.encode(JSON.stringify(data,null,2)),counts};
}

export async function backupClinicToDrive(env,kind="manual"){
 let backupId=null;
 try{
  const connection=await getConnection(env);
  if(!connection?.root_folder_id)return {success:false,skipped:true,reason:"Clinic Drive folder is not selected"};
  if(kind==="daily"){
   if(!connection.auto_backup_daily)return {success:true,skipped:true,reason:"Daily backup is disabled"};
   const recent=await env.DB.prepare("SELECT id,status,created_at FROM google_drive_backups WHERE google_email=? AND backup_kind='daily' AND backup_date=? ORDER BY id DESC LIMIT 1").bind(connection.google_email,dateStamp()).first();
   if(recent?.status==="saved")return {success:true,skipped:true,reason:"Today's daily backup already exists"};
   const lastUpdate=Date.parse(String(recent?.updated_at||recent?.created_at||"").replace(" ","T")+"Z");
   const age=Number.isFinite(lastUpdate)?Date.now()-lastUpdate:Infinity;
   if(recent?.status==="processing"&&age<15*60*1000)return {success:true,skipped:true,reason:"Today's backup is already running"};
   if(recent?.status==="failed"&&age<5*60*1000)return {success:true,skipped:true,reason:"Daily backup retry is cooling down"};
   if(recent?.id){
    backupId=recent.id;
    await env.DB.prepare("UPDATE google_drive_backups SET status='processing',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(backupId).run();
   }
  }
  if(!backupId){
   const stamp=dateStamp()+"_"+timeStamp();
   const fileName="Ultimate_Esthetics_Clinic_"+(kind==="daily"?"DailyBackup_":"ManualBackup_")+stamp+".json";
   const inserted=await env.DB.prepare("INSERT INTO google_drive_backups(google_email,backup_kind,backup_date,file_name,status) VALUES(?,?,?,?,'processing')").bind(connection.google_email,kind,kind==="daily"?dateStamp():new Date().toISOString(),fileName).run();
   backupId=inserted.meta.last_row_id;
  }
  const [tokens,snapshot]=await Promise.all([decryptTokens(connection.encrypted_tokens,env),buildSnapshot(env)]);
  if(snapshot.bytes.byteLength>10*1024*1024)throw new Error("Clinic data backup is larger than 10 MB. Use the per-patient Drive records and contact the developer for a large export.");
  const folder=await ensureBackupFolder(env,tokens,connection.root_folder_id);
  const row=await env.DB.prepare("SELECT file_name FROM google_drive_backups WHERE id=?").bind(backupId).first();
  const saved=await uploadBackup(env,tokens,folder.id,row.file_name,snapshot.bytes);
  await env.DB.prepare("UPDATE google_drive_backups SET drive_file_id=?,web_view_link=?,size_bytes=?,status='saved',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(saved.id,saved.webViewLink||null,snapshot.bytes.byteLength,backupId).run();
  return {success:true,backup_id:backupId,file_name:row.file_name,web_view_link:saved.webViewLink||null,size_bytes:snapshot.bytes.byteLength,counts:snapshot.counts};
 }catch(error){
  if(backupId)await env.DB.prepare("UPDATE google_drive_backups SET status='failed',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(String(error?.message||"Clinic backup failed").slice(0,500),backupId).run().catch(()=>{});
  return {success:false,backup_id:backupId,error:String(error?.message||"Clinic backup failed")};
 }
}
