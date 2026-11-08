const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};
async function currentUser(request,env){
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\\s*)admin_token=([^;]+)/);if(!m)return null;
 const token=decodeURIComponent(m[1]),h=await hash(token);
 return env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.first_name,u.last_name,u.password_hash,u.password_salt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND u.is_active=1").bind(h).first();
}
async function verify(u,password){return !!u&&!!password&&(await hash(String(password)+u.password_salt))===u.password_hash;}
export async function onRequestGet({request,env}) {
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 return json({username:u.username,role:u.role,first_name:u.first_name||"",last_name:u.last_name||"",email:u.email||""});
}
export async function onRequestPost({request,env}) {
 let b;try{b=await request.json()}catch{return json({error:"Invalid request."},400)}
 const action=String(b.action||"");
 // The emailed one-time link is the only authorization needed to complete an email change.
 if(action==="consume_email_change"){
  const token=String(b.token||"");if(!token)return json({error:"Invalid or expired verification link."},400);
  const tokenHash=await hash(token);
  const pending=await env.DB.prepare("SELECT ec.id,ec.user_id,ec.new_email,u.username FROM email_changes ec JOIN users u ON u.id=ec.user_id WHERE ec.token_hash=? AND ec.used_at IS NULL AND ec.expires_at>datetime('now') AND u.is_active=1").bind(tokenHash).first();
  if(!pending)return json({error:"This verification link has expired or has already been used. Request a new one."},400);
  const existing=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?").bind(pending.new_email,pending.user_id).first();
  if(existing)return json({error:"This email address is already linked to another account."},409);
  try{
   await env.DB.batch([
    env.DB.prepare("UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(pending.new_email,pending.user_id),
    env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(pending.id),
    env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>? AND used_at IS NULL").bind(pending.user_id,pending.id),
    env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'profile_email_updated','user','Recovery email changed after verification')").bind(pending.user_id,pending.username)
   ]);
  }catch(e){return json({error:"Could not update this email. It may already be in use."},409);}
  return json({success:true,message:"Email verified and updated successfully. Your new email is now active."});
 }
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 if(!await verify(u,b.password))return json({error:"Login ID or password is incorrect."},403);
 if(String(b.username||"").trim().toLowerCase()!==u.username.toLowerCase())return json({error:"Enter your current Login ID."},403);
 if(action==="verify")return json({success:true,profile:{username:u.username,role:u.role,first_name:u.first_name||"",last_name:u.last_name||"",email:u.email||""}});
 if(action==="update_name"){
  const first=String(b.first_name||"").trim(),last=String(b.last_name||"").trim();
  if(!first||!last||first.length>80||last.length>80)return json({error:"Enter a valid first and last name."},400);
  await env.DB.prepare("UPDATE users SET first_name=?,last_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,u.user_id).run();
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'profile_name_updated','user','User updated their own profile name')").bind(u.user_id,u.username).run();
  return json({success:true,first_name:first,last_name:last});
 }
 if(action==="request_email_change"){
  const email=String(b.new_email||"").trim().toLowerCase();
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return json({error:"Enter a valid new email address."},400);
  if(email===String(u.email||"").toLowerCase())return json({error:"This is already your current email address."},400);
  const existing=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?").bind(email,u.user_id).first();
  if(existing)return json({error:"This email address is already linked to another account."},409);
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return json({error:"Email sender is not configured. Your current email has not been changed."},503);
  const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const tokenHash=await hash(raw),expires=new Date(Date.now()+30*60*1000).toISOString().replace("T"," ").slice(0,19);
  await env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL").bind(u.user_id).run();
  await env.DB.prepare("INSERT INTO email_changes(user_id,new_email,token_hash,expires_at) VALUES(?,?,?,?)").bind(u.user_id,email,tokenHash,expires).run();
  const link=new URL("/admin/verify-email.html?token="+encodeURIComponent(raw),new URL(request.url).origin).toString();
  const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:"Verify your Ultimate Esthetics account email",html:"<p>A request was made to change the recovery email for the <strong>"+u.username+"</strong> account.</p><p><a href='"+link+"'>Verify this email address</a></p><p>This one-time link expires in 30 minutes. Your current email stays active until you verify the new address. If you did not request this change, ignore this message.</p>"})});
  if(!mail.ok){await env.DB.prepare("UPDATE email_changes SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();return json({error:"Email provider could not send the verification email. Your current email has not been changed."},502);}
  return json({success:true,message:"Verification link sent to your new email address. Your current email will stay active until you verify it."});
 }
 return json({error:"Unsupported profile action."},400);
}
