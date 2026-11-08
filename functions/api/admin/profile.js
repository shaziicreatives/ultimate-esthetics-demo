const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};
async function currentUser(request,env){
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/);if(!m)return null;
 const token=decodeURIComponent(m[1]),h=await hash(token);
 return env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.first_name,u.last_name,u.password_hash,u.password_salt FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND u.is_active=1").bind(h).first();
}
async function verify(u,password){return !!u&&!!password&&(await hash(String(password)+u.password_salt))===u.password_hash;}
export async function onRequestGet({request,env}) {
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 return json({username:u.username,role:u.role,first_name:u.first_name||"",last_name:u.last_name||"",email:u.email||""});
}
export async function onRequestPost({request,env}) {
 const u=await currentUser(request,env);if(!u)return json({error:"Unauthorized"},401);
 let b;try{b=await request.json()}catch{return json({error:"Invalid request."},400)}
 if(!await verify(u,b.password))return json({error:"Login ID or password is incorrect."},403);
 if(String(b.username||"").trim().toLowerCase()!==u.username.toLowerCase())return json({error:"Enter your current Login ID."},403);
 const action=String(b.action||"");
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
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Enter a valid new email address."},400);
  if(email===String(u.email||"").toLowerCase())return json({error:"This is already your current email address."},400);
  return json({error:"Email verification delivery is not configured yet. Your email has not been changed."},503);
 }
 return json({error:"Unsupported profile action."},400);
}
