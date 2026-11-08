import {ownerSession,sha256,encryptTokens,oauthRedirect,json} from "../../../../_shared/google-drive.js";
export async function onRequestGet({request,env}){
 const url=new URL(request.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),error=url.searchParams.get("error");
 const back=new URL("/admin/",request.url);
 if(error||!code||!state){back.searchParams.set("drive","oauth_error");return Response.redirect(back.toString(),302);}
 const user=await ownerSession(request,env);if(!user)return json({error:"Owner session expired. Sign in as Owner and connect Google Drive again."},403);
 try{
  const stateHash=await sha256(state),row=await env.DB.prepare("SELECT owner_user_id FROM google_drive_oauth_states WHERE state_hash=? AND expires_at>?").bind(stateHash,Math.floor(Date.now()/1000)).first();
  if(!row||row.owner_user_id!==user.user_id)return json({error:"Google authorization state is invalid or expired."},400);
  await env.DB.prepare("DELETE FROM google_drive_oauth_states WHERE state_hash=?").bind(stateHash).run();
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:oauthRedirect(request),grant_type:"authorization_code"})});
  const tokens=await tokenResponse.json();
  if(!tokenResponse.ok)throw new Error(tokens.error_description||tokens.error||"Google token exchange failed");
  if(!tokens.refresh_token)throw new Error("Google did not return a refresh token. Revoke the app's previous access in Google Account permissions, then reconnect.");
  const profileResponse=await fetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:"Bearer "+tokens.access_token}});
  const profile=await profileResponse.json();
  if(!profileResponse.ok||!profile.email)throw new Error("Could not verify the Google account email.");
  tokens.expiry_date=Date.now()+Number(tokens.expires_in||3600)*1000;
  const encrypted=await encryptTokens(tokens,env);
  const previous=await env.DB.prepare("SELECT google_email FROM google_drive_connections WHERE id=1").first();
  if(previous?.google_email&&previous.google_email.toLowerCase()!==profile.email.toLowerCase()){
   await env.DB.batch([
    env.DB.prepare("INSERT INTO google_drive_folder_history(google_email,folder_kind,patient_id,folder_id,folder_name) SELECT ?, 'patient',patient_id,folder_id,folder_name FROM google_drive_patient_folders").bind(previous.google_email),
    env.DB.prepare("INSERT INTO google_drive_folder_history(google_email,folder_kind,patient_id,visit_id,folder_id,folder_name) SELECT ?, 'visit',patient_id,visit_id,folder_id,folder_name FROM google_drive_visit_folders").bind(previous.google_email)
   ]);
  }
  await env.DB.prepare("INSERT INTO google_drive_connections(id,owner_user_id,google_email,encrypted_tokens,token_expires_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_user_id=excluded.owner_user_id,google_email=excluded.google_email,encrypted_tokens=excluded.encrypted_tokens,token_expires_at=excluded.token_expires_at,selected_drive_id=NULL,selected_drive_name=NULL,root_folder_id=NULL,root_folder_name=NULL,connected_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").bind(user.user_id,profile.email,encrypted,tokens.expiry_date).run();
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'google_drive_connected','integration','Google Drive account connected: '||?)").bind(user.user_id,user.username,profile.email).run();
  back.searchParams.set("drive","connected");return Response.redirect(back.toString(),302);
 }catch(e){back.searchParams.set("drive","oauth_error");back.searchParams.set("message",String(e.message||"Google authorization failed").slice(0,180));return Response.redirect(back.toString(),302);}
}
