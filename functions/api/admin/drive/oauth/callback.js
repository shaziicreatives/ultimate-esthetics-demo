import {ownerSession,sha256,encryptTokens,oauthRedirect,json} from "../../../../_shared/google-drive.js";
export async function onRequestGet({request,env}){
 const url=new URL(request.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),error=url.searchParams.get("error");
 const back=new URL("/admin/",request.url);
 if(error||!code||!state){back.searchParams.set("drive","oauth_error");return Response.redirect(back.toString(),302);}
 const user=await ownerSession(request,env);if(!user)return json({error:"Owner session expired. Sign in as Owner and connect Google Drive again."},403);
 try{
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_DRIVE_TOKEN_KEY)throw new Error("Google Drive credentials are not configured in Preview.");
  const stateHash=await sha256(state),row=await env.DB.prepare("SELECT owner_user_id FROM google_drive_oauth_states WHERE state_hash=? AND expires_at>?").bind(stateHash,Math.floor(Date.now()/1000)).first();
  if(!row||row.owner_user_id!==user.user_id)return json({error:"Google authorization state is invalid or expired."},400);
  await env.DB.prepare("DELETE FROM google_drive_oauth_states WHERE state_hash=?").bind(stateHash).run();
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:oauthRedirect(request),grant_type:"authorization_code"})});
  const tokens=await tokenResponse.json();
  if(!tokenResponse.ok)throw new Error(tokens.error_description||tokens.error||"Google token exchange failed");
  if(!tokens.refresh_token)throw new Error("Google did not return a refresh token. Revoke this app in Google Account permissions and reconnect.");
  const profileResponse=await fetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:"Bearer "+tokens.access_token}});
  const profile=await profileResponse.json();
  if(!profileResponse.ok||!profile.email)throw new Error("Could not verify the Google account email.");
  tokens.expiry_date=Date.now()+Number(tokens.expires_in||3600)*1000;
  const encrypted=await encryptTokens(tokens,env);
  const previous=await env.DB.prepare("SELECT google_email,root_folder_id,root_folder_name,selected_drive_id,selected_drive_name,auto_save_invoice_pdf,auto_save_patient_record,auto_save_visit_record,auto_backup_daily,auto_save_visit_pdf FROM google_drive_connections WHERE id=1").first();
  const sameAccount=!!previous?.google_email&&previous.google_email.toLowerCase()===profile.email.toLowerCase();
  if(previous&&!sameAccount){
   await env.DB.batch([
    env.DB.prepare("INSERT INTO google_drive_folder_history(google_email,folder_kind,patient_id,folder_id,folder_name) SELECT ?, 'patient',patient_id,folder_id,folder_name FROM google_drive_patient_folders").bind(previous.google_email),
    env.DB.prepare("INSERT INTO google_drive_folder_history(google_email,folder_kind,patient_id,visit_id,folder_id,folder_name) SELECT ?, 'visit',patient_id,visit_id,folder_id,folder_name FROM google_drive_visit_folders").bind(previous.google_email),
    env.DB.prepare("DELETE FROM google_drive_patient_folders"),
    env.DB.prepare("DELETE FROM google_drive_visit_folders")
   ]);
  }
  const rootId=sameAccount?previous.root_folder_id:null,rootName=sameAccount?previous.root_folder_name:null;
  const selectedId=sameAccount?previous.selected_drive_id:null,selectedName=sameAccount?previous.selected_drive_name:null;
  const autoInvoice=previous?.auto_save_invoice_pdf??1,autoPatient=previous?.auto_save_patient_record??1,autoVisit=previous?.auto_save_visit_record??1,autoBackup=previous?.auto_backup_daily??1,autoVisitPdf=previous?.auto_save_visit_pdf??1;
  await env.DB.prepare("INSERT INTO google_drive_connections(id,owner_user_id,google_email,encrypted_tokens,token_expires_at,selected_drive_id,selected_drive_name,root_folder_id,root_folder_name,auto_save_invoice_pdf,auto_save_patient_record,auto_save_visit_record,auto_backup_daily,auto_save_visit_pdf) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_user_id=excluded.owner_user_id,google_email=excluded.google_email,encrypted_tokens=excluded.encrypted_tokens,token_expires_at=excluded.token_expires_at,selected_drive_id=excluded.selected_drive_id,selected_drive_name=excluded.selected_drive_name,root_folder_id=excluded.root_folder_id,root_folder_name=excluded.root_folder_name,connected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP")
   .bind(user.user_id,profile.email,encrypted,tokens.expiry_date,selectedId,selectedName,rootId,rootName,autoInvoice,autoPatient,autoVisit,autoBackup,autoVisitPdf).run();
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'google_drive_connected','integration','Google Drive account connected: '||?)").bind(user.user_id,user.username,profile.email).run();
  back.searchParams.set("drive","connected");return Response.redirect(back.toString(),302);
 }catch(e){back.searchParams.set("drive","oauth_error");back.searchParams.set("message",String(e.message||"Google authorization failed").slice(0,180));return Response.redirect(back.toString(),302);}
}
