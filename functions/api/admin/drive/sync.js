import {ownerSession,json} from "../../../_shared/google-drive.js";
import {syncVisitToDrive} from "../../../_shared/google-drive-sync.js";
export async function onRequestGet({request,env}){
 const owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const jobs=await env.DB.prepare("SELECT j.id,j.patient_id,j.visit_id,j.status,j.attempts,j.last_error,j.created_at,j.updated_at,p.name patient_name,v.invoice_number FROM google_drive_sync_jobs j JOIN patients p ON p.id=j.patient_id LEFT JOIN visits v ON v.id=j.visit_id ORDER BY j.updated_at DESC LIMIT 100").all();
  return json({jobs:jobs.results||[]});
 }catch(e){return json({error:"Drive sync queue is not available. Apply migration 0009 first."},503);}
}
export async function onRequestPost(context){
 const {request,env}=context,owner=await ownerSession(request,env);if(!owner)return json({error:"Owner access required"},403);
 try{
  const b=await request.json(),id=Number(b.job_id);
  if(!Number.isSafeInteger(id)||id<1)return json({error:"Choose a valid failed job."},400);
  const job=await env.DB.prepare("SELECT id,visit_id,status FROM google_drive_sync_jobs WHERE id=?").bind(id).first();
  if(!job)return json({error:"Sync job not found."},404);
  if(!job.visit_id)return json({error:"This job has no visit to retry."},400);
  if(context.waitUntil)context.waitUntil(syncVisitToDrive(env,job.visit_id));
  else await syncVisitToDrive(env,job.visit_id);
  return json({success:true,message:"Drive synchronization retry started."});
 }catch(e){return json({error:String(e.message||"Could not retry Drive sync")},500);}
}
