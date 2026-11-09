import {ownerSession,json} from "../../../_shared/google-drive.js";
import {syncVisitToDrive,syncPatientToDrive} from "../../../_shared/google-drive-sync.js";

export async function onRequestGet(context){
 const {request,env}=context;
 const owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const connection=await env.DB.prepare("SELECT root_folder_id FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(owner.user_id).first();
  let autoScheduled=0;
  if(connection?.root_folder_id){
   const retryable=await env.DB.prepare("SELECT id,visit_id,patient_id,job_kind FROM google_drive_sync_jobs WHERE status IN ('pending','failed') AND attempts<6 AND updated_at<=datetime('now','-1 minute') ORDER BY created_at LIMIT 3").all();
   for(const job of retryable.results||[]){
    const run=job.job_kind==="patient"?syncPatientToDrive(env,job.patient_id):syncVisitToDrive(env,job.visit_id);
    if(context.waitUntil)context.waitUntil(run);else await run;
    autoScheduled++;
   }
  }
  const jobs=await env.DB.prepare("SELECT j.id,j.patient_id,j.visit_id,j.status,j.attempts,j.last_error,j.created_at,j.updated_at,p.name patient_name,v.invoice_number FROM google_drive_sync_jobs j JOIN patients p ON p.id=j.patient_id LEFT JOIN visits v ON v.id=j.visit_id ORDER BY j.updated_at DESC LIMIT 100").all();
  return json({jobs:jobs.results||[],auto_retry_scheduled:autoScheduled});
 }catch(e){return json({error:"Drive sync queue is not available. Apply the Preview Google Drive migration first."},503);}
}
export async function onRequestPost(context){
 const {request,env}=context,owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const b=await request.json();
  if(b.action==="backfill"){
   const connection=await env.DB.prepare("SELECT root_folder_id FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(owner.user_id).first();
   if(!connection?.root_folder_id)return json({error:"Connect Google Drive and select the clinic folder first."},409);
   const afterVisit=Math.max(0,Number(b.after_visit_id)||0),afterPatient=Math.max(0,Number(b.after_patient_id)||0);
   const visits=await env.DB.prepare("SELECT id FROM visits WHERE id>? ORDER BY id LIMIT 5").bind(afterVisit).all();
   const patients=await env.DB.prepare("SELECT p.id FROM patients p WHERE p.id>? AND NOT EXISTS(SELECT 1 FROM visits v WHERE v.patient_id=p.id) ORDER BY p.id LIMIT 5").bind(afterPatient).all();
   for(const v of visits.results||[]){
    const run=syncVisitToDrive(env,v.id);
    if(context.waitUntil)context.waitUntil(run);else await run;
   }
   for(const p of patients.results||[]){
    const run=syncPatientToDrive(env,p.id);
    if(context.waitUntil)context.waitUntil(run);else await run;
   }
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
