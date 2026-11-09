import {ownerSession,json} from "../../../_shared/google-drive.js";
import {syncVisitToDrive,syncPatientToDrive} from "../../../_shared/google-drive-sync.js";
import {backupClinicToDrive} from "../../../_shared/google-drive-backup.js";

export async function onRequestGet(context){
 const {request,env}=context;
 const owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const connection=await env.DB.prepare("SELECT root_folder_id,google_email,auto_backup_daily FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(owner.user_id).first();
  let autoScheduled=0,backupScheduled=false;
  if(connection?.root_folder_id){
   const retryable=await env.DB.prepare("SELECT id,visit_id,patient_id,job_kind FROM google_drive_sync_jobs WHERE status IN ('pending','failed') AND attempts<6 AND updated_at<=datetime('now','-1 minute') ORDER BY created_at LIMIT 3").all();
   const retryTask=(async()=>{
    for(const job of retryable.results||[]){
     if(job.job_kind==="patient")await syncPatientToDrive(env,job.patient_id);
     else await syncVisitToDrive(env,job.visit_id);
    }
   })();
   if(context.waitUntil)context.waitUntil(retryTask);else await retryTask;
   autoScheduled=retryable.results?.length||0;
   if(connection.auto_backup_daily){
    const run=backupClinicToDrive(env,"daily");
    if(context.waitUntil)context.waitUntil(run);else await run;
    backupScheduled=true;
   }
  }
  const [jobs,files,backups]=await Promise.all([
   env.DB.prepare("SELECT j.id,j.patient_id,j.visit_id,j.status,j.attempts,j.last_error,j.created_at,j.updated_at,p.name patient_name,v.invoice_number FROM google_drive_sync_jobs j JOIN patients p ON p.id=j.patient_id LEFT JOIN visits v ON v.id=j.visit_id ORDER BY j.updated_at DESC LIMIT 100").all(),
   env.DB.prepare("SELECT f.id,f.patient_id,f.visit_id,f.file_kind,f.file_name,f.web_view_link,f.updated_at,p.name patient_name,v.invoice_number FROM google_drive_files f JOIN patients p ON p.id=f.patient_id LEFT JOIN visits v ON v.id=f.visit_id WHERE f.google_email=? ORDER BY f.updated_at DESC,f.id DESC LIMIT 100").bind(connection?.google_email||"").all(),
   env.DB.prepare("SELECT id,backup_kind,backup_date,file_name,web_view_link,size_bytes,status,last_error,created_at,updated_at FROM google_drive_backups WHERE google_email=? ORDER BY id DESC LIMIT 30").bind(connection?.google_email||"").all()
  ]);
  return json({jobs:jobs.results||[],files:files.results||[],backups:backups.results||[],auto_retry_scheduled:autoScheduled,auto_backup_scheduled:backupScheduled});
 }catch(e){return json({error:"Drive sync queue is not available. Apply the Preview Google Drive migration first."},503);}
}

export async function onRequestPost(context){
 const {request,env}=context,owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const b=await request.json();
  if(b.action==="backup"){
   const connection=await env.DB.prepare("SELECT root_folder_id FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(owner.user_id).first();
   if(!connection?.root_folder_id)return json({error:"Select the clinic Drive folder before making a backup."},409);
   const task=backupClinicToDrive(env,"manual");
   if(context.waitUntil){context.waitUntil(task);return json({success:true,message:"Clinic data backup has started. Refresh to see its status."},202);}
   const result=await task;
   return result.success?json(result,201):json({error:result.error||"Clinic backup failed."},500);
  }
  if(b.action==="backfill"){
   const connection=await env.DB.prepare("SELECT root_folder_id FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(owner.user_id).first();
   if(!connection?.root_folder_id)return json({error:"Connect Google Drive and select the clinic folder first."},409);
   const afterVisit=Math.max(0,Number(b.after_visit_id)||0),afterPatient=Math.max(0,Number(b.after_patient_id)||0);
   const visits=await env.DB.prepare("SELECT id FROM visits WHERE id>? ORDER BY id LIMIT 5").bind(afterVisit).all();
   const patients=await env.DB.prepare("SELECT p.id FROM patients p WHERE p.id>? AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.patient_id=p.id) ORDER BY p.id LIMIT 5").bind(afterPatient).all();
   const backfillTask=(async()=>{
    for(const v of visits.results||[])await syncVisitToDrive(env,v.id);
    for(const p of patients.results||[])await syncPatientToDrive(env,p.id);
   })();
   if(context.waitUntil)context.waitUntil(backfillTask);else await backfillTask;
   const nextVisit=visits.results?.length?visits.results[visits.results.length-1].id:afterVisit;
   const nextPatient=patients.results?.length?patients.results[patients.results.length-1].id:afterPatient;
   const moreV=await env.DB.prepare("SELECT 1 FROM visits WHERE id>? LIMIT 1").bind(nextVisit).first();
   const moreP=await env.DB.prepare("SELECT 1 FROM patients p WHERE p.id>? AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.patient_id=p.id) LIMIT 1").bind(nextPatient).first();
   return json({success:true,scheduled_visits:visits.results?.length||0,scheduled_patients:patients.results?.length||0,next_after_visit_id:nextVisit,next_after_patient_id:nextPatient,has_more:!!(moreV||moreP)});
  }
  const id=Number(b.job_id);
  if(!Number.isSafeInteger(id)||id<1)return json({error:"Choose a valid sync job."},400);
  const job=await env.DB.prepare("SELECT id,visit_id,patient_id,job_kind,status FROM google_drive_sync_jobs WHERE id=?").bind(id).first();
  if(!job)return json({error:"Sync job not found."},404);
  const run=job.job_kind==="patient"?syncPatientToDrive(env,job.patient_id):syncVisitToDrive(env,job.visit_id);
  if(context.waitUntil)context.waitUntil(run);else await run;
  return json({success:true,message:"Drive synchronization retry started."});
 }catch(e){return json({error:String(e.message||"Could not retry Drive sync")},500);}
}
