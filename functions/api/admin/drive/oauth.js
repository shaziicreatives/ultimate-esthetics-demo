import {ownerSession,sha256,encryptTokens,oauthRedirect,json} from "../../../_shared/google-drive.js";
export async function onRequestGet({request,env}){
 const user=await ownerSession(request,env);if(!user)return json({error:"Owner access required"},403);
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_DRIVE_TOKEN_KEY)return json({error:"Google Drive credentials are not configured in Cloudflare Pages secrets."},503);
 const state=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const hash=await sha256(state),expiry=Math.floor(Date.now()/1000)+600;
 await env.DB.prepare("DELETE FROM google_drive_oauth_states WHERE expires_at<?").bind(Math.floor(Date.now()/1000)).run();
 await env.DB.prepare("INSERT INTO google_drive_oauth_states(state_hash,owner_user_id,expires_at) VALUES(?,?,?)").bind(hash,user.user_id,expiry).run();
 const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:oauthRedirect(request),response_type:"code",scope:"openid email https://www.googleapis.com/auth/drive.file",access_type:"offline",prompt:"consent",include_granted_scopes:"true",state}).toString();
 return Response.redirect(url.toString(),302);
}
export async function onRequestPost(){return json({error:"Method not allowed"},405);}
