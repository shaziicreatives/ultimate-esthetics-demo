async function session(request, env) {
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/); if(!m)return null;
 const token=decodeURIComponent(m[1]); const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const h=Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
 const u=await env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.doctor_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND u.is_active=1").bind(h).first();
 if(u&&u.role==="owner"&&u.username.toLowerCase()==="admin")u.role="admin";
 return u;
}
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};
export async function onRequestPost({request,env}) {
 const u=await session(request,env);if(!u)return json({error:"Unauthorized"},401);
 const b=await request.json(),next=String(b.new_password||"");
 if(next.length<10||!/[0-9]/.test(next))return json({error:"Use at least 10 characters and include a number."},400);
 if(b.target_username){
  if(u.role!=="owner" || u.username.toLowerCase()!=="owner")return json({error:"Only the Owner can change staff passwords."},403);
  const target=String(b.target_username).toLowerCase();
  if(!["admin","reception"].includes(target))return json({error:"Select Admin or Reception."},400);
  const owner=await env.DB.prepare("SELECT id,password_hash,password_salt FROM users WHERE id=? AND role='owner' AND is_active=1").bind(u.user_id).first();
  if(!owner || await hash(String(b.owner_password||"")+owner.password_salt)!==owner.password_hash)return json({error:"Owner password is incorrect."},403);
  const staff=await env.DB.prepare("SELECT id,username,role FROM users WHERE username=? COLLATE NOCASE AND is_active=1").bind(target).first();
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,"0")).join(""),ph=await hash(next+salt);
  const canonical=target==="admin"?"Admin":"Reception";
  // The existing schema stores legacy Admin accounts with role='owner'; normalize Admin to
  // the non-owner Admin role in session responses. Reception remains receptionist.
  const storedRole=target==="admin"?"owner":"receptionist";
  if(!staff){
   const email=target==="admin"?"admin.staff@ultimateesthetics.local":"reception@ultimateesthetics.local";
   await env.DB.prepare("INSERT INTO users(username,email,password_hash,password_salt,role) VALUES(?,?,?,?,?)").bind(canonical,email,ph,salt,storedRole).run();
   await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'staff_account_created','user',?)").bind(u.user_id,u.username,target+" account created by Owner").run();
   return json({success:true,message:canonical+" account created with the new password."});
  }
  await env.DB.batch([
   env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ph,salt,staff.id),
   env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(staff.id),
   env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'staff_password_changed','user',?,'Staff password changed by Owner; sessions revoked')").bind(u.user_id,u.username,staff.id)
  ]);
  return json({success:true,message:staff.username+" password updated; their existing sessions were signed out."});
 }
 if(u.role!=="owner")return json({error:"Only the Owner can change passwords. Please contact the Owner."},403);
 const current=String(b.current_password||"");
 const row=await env.DB.prepare("SELECT id,password_hash,password_salt FROM users WHERE id=?").bind(u.user_id).first();
 if(!row||await hash(current+row.password_salt)!==row.password_hash)return json({error:"Current password is incorrect."},400);
 const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,"0")).join(""),ph=await hash(next+salt);
 await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ph,salt,u.user_id).run();
 await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.user_id).run();
 await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'password_changed','user','Password changed; all sessions revoked')").bind(u.user_id,u.username).run();
 return new Response(JSON.stringify({success:true}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":"admin_token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax"}});
}