import { getAdminSession } from "../../_shared/admin-session.js";
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const maskEmail=value=>{const email=String(value||"");const at=email.lastIndexOf("@");if(at<1)return "Hidden";const local=email.slice(0,at),domain=email.slice(at+1);return local.length<=4?local[0]+"**"+local.slice(-1)+"@"+domain:local.slice(0,2)+"****"+local.slice(-2)+"@"+domain;};
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};
async function currentUser(request,env){
 const session=await getAdminSession(request,env);
 if(!session)return null;
 const u=await env.DB.prepare("SELECT u.username,u.email,u.role,u.first_name,u.last_name,u.password_hash,u.password_salt FROM users u WHERE u.id=? AND u.is_active=1").bind(session.user_id).first();
 if(u&&u.role==="owner"&&u.username.toLowerCase()==="admin")u.role="admin";
 if(u)u.user_id=session.user_id;
 return u;
}
async function verify(u,password){return !!u&&!!password&&(await hash(String(password)+u.password_salt))===u.password_hash;}
export async function onRequestGet({request,env}) {
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 if(u.role!=="owner")return json({error:"Login from Owner account."},403);
 return json({username:u.username,role:u.role,first_name:u.first_name||"",last_name:u.last_name||"",email:maskEmail(u.email)});
}
export async function onRequestPost({request,env}) {
 let b;try{b=await request.json()}catch{return json({error:"Invalid request."},400)}
 const action=String(b.action||"");
 // The existing email must approve first; only then is a confirmation sent to the new email.
 if(action==="consume_email_change"){
  const token=String(b.token||"");if(!token)return json({error:"Invalid or expired verification link."},400);
  const tokenHash=await hash(token);
  const pending=await env.DB.prepare("SELECT ec.id,ec.user_id,ec.new_email,ec.current_verified_at,ec.new_token_hash,ec.new_expires_at,ec.token_hash,ec.expires_at,u.username FROM email_changes ec JOIN users u ON u.id=ec.user_id WHERE (ec.token_hash=? OR ec.new_token_hash=?) AND ec.used_at IS NULL AND u.is_active=1").bind(tokenHash,tokenHash).first();
  if(!pending)return json({error:"This verification link has expired or has already been used."},400);
  if(pending.token_hash===tokenHash && !pending.current_verified_at){
   if(!pending.expires_at || new Date(pending.expires_at.replace(" ","T")+"Z")<=new Date())return json({error:"Existing-email link has expired. Request a new change."},400);
   if(!env.RESEND_API_KEY||!env.MAIL_FROM)return json({error:"Email sender is not configured."},503);
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
   const nextHash=await hash(raw),nextExpiry=new Date(Date.now()+30*60*1000).toISOString().replace("T"," ").slice(0,19);
   const link=new URL("/admin/verify-email.html?token="+encodeURIComponent(raw),new URL(request.url).origin).toString();
   const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM,to:[pending.new_email],subject:"Confirm your new Ultimate Esthetics email",html:"<p>Your existing email was confirmed for account <strong>"+pending.username+"</strong>.</p><p><a href='"+link+"'>Confirm and attach the new email</a></p><p>This link expires in 30 minutes.</p>"})});
   if(!mail.ok)return json({error:"Could not send confirmation to the new email. Existing email remains active."},502);
   await env.DB.prepare("UPDATE email_changes SET current_verified_at=CURRENT_TIMESTAMP,new_token_hash=?,new_expires_at=? WHERE id=?").bind(nextHash,nextExpiry,pending.id).run();
   return json({success:true,message:"Existing email confirmed. A second confirmation link has been sent to your new email. Your account email will change only after that link is opened."});
  }
  if(!pending.current_verified_at || pending.new_token_hash!==tokenHash || !pending.new_expires_at || new Date(pending.new_expires_at.replace(" ","T")+"Z")<=new Date())return json({error:"New-email confirmation link has expired or is invalid."},400);
  const existing=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?").bind(pending.new_email,pending.user_id).first();
  if(existing)return json({error:"This email is already linked to another account."},409);
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(pending.new_email,pending.user_id),
   env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(pending.id),
   env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>? AND used_at IS NULL").bind(pending.user_id,pending.id),
   env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'profile_email_updated','user','Email changed after existing and new email verification')").bind(pending.user_id,pending.username)
  ]);
  return json({success:true,message:"Both email addresses verified. Your new email is now active."});
 }
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 if(u.role!=="owner")return json({error:"Login from Owner account."},403);
 if(!await verify(u,b.password))return json({error:"Login ID or password is incorrect."},403);
 if(String(b.username||"").trim().toLowerCase()!==u.username.toLowerCase())return json({error:"Enter your current Login ID."},403);
 if(action==="verify")return json({success:true,profile:{username:u.username,role:u.role,first_name:u.first_name||"",last_name:u.last_name||"",email:maskEmail(u.email)}});
 if(action==="update_name"){
  const first=String(b.first_name||"").trim(),last=String(b.last_name||"").trim();
  if(!first||!last||first.length>80||last.length>80)return json({error:"Enter a valid first and last name."},400);
  await env.DB.prepare("UPDATE users SET first_name=?,last_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,u.user_id).run();
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'profile_name_updated','user','User updated their own profile name')").bind(u.user_id,u.username).run();
  return json({success:true,first_name:first,last_name:last});
 }
 if(action==="request_email_change"){
  const email=String(b.new_email||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Enter a valid new email address."},400);
  if(email===String(u.email||"").toLowerCase())return json({error:"This is already your current email address."},400);
  const existing=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?").bind(email,u.user_id).first();
  if(existing)return json({error:"This email address is already linked to another account."},409);
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return json({error:"Email sender is not configured. Your current email has not been changed."},503);
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return json({error:"Email sender is not configured. Your current email has not been changed."},503);
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const tokenHash=await hash(raw),expires=new Date(Date.now()+30*60*1000).toISOString().replace("T"," ").slice(0,19);
  await env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").bind(u.user_id).run();
  await env.DB.prepare("INSERT INTO email_changes(user_id,new_email,token_hash,expires_at) VALUES(?,?,?,?)").bind(u.user_id,email,tokenHash,expires).run();
  const link=new URL("/admin/verify-email.html?token="+encodeURIComponent(raw),new URL(request.url).origin).toString();
  const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM,to:[u.email],subject:"Confirm your email change · Ultimate Esthetics",html:"<p>Request to change account <strong>"+u.username+"</strong> email to <strong>"+email+"</strong>.</p><p><a href='"+link+"'>Approve this change from your existing email</a></p><p>After approval, a second link will be sent to the new email. Your account email changes only after both links are confirmed. Link expires in 30 minutes.</p>"})});
  if(!mail.ok){await env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();return json({error:"Could not send confirmation to your existing email. Your current email has not been changed."},502);}
  return json({success:true,message:"Confirmation link sent to your existing email. Your current email stays active until both confirmations are completed."});
 }
 return json({error:"Unsupported profile action."},400);
}
