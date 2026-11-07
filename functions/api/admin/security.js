const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function auth(request,env){
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/);if(!m)return null;
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(decodeURIComponent(m[1])));
 const h=Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
 const user=await env.DB.prepare("SELECT s.id session_id,s.user_id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND u.is_active=1").bind(h).first();
 return user?{...user,tokenHash:h}:null;
}
function device(ua){ua=String(ua||"");const os=/Windows/i.test(ua)?"Windows":/Android/i.test(ua)?"Android":/(iPhone|iPad)/i.test(ua)?"iOS":/Mac OS/i.test(ua)?"macOS":/Linux/i.test(ua)?"Linux":"Unknown OS";const browser=/Edg\//i.test(ua)?"Edge":/Chrome\//i.test(ua)?"Chrome":/Firefox\//i.test(ua)?"Firefox":/Safari\//i.test(ua)?"Safari":"Browser";return browser+" · "+os;}
export async function onRequestGet({request,env}){
 try{
  const u=await auth(request,env);if(!u)return json({error:"Unauthorized"},401);
  const [logins,sessions,activity,users]=await Promise.all([
   env.DB.prepare("SELECT id,username,ip,success,created_at FROM login_attempts ORDER BY id DESC").all(),
   env.DB.prepare("SELECT s.id,s.user_id,s.ip,s.user_agent,s.expires_at,s.created_at,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE datetime(s.expires_at)>datetime('now') ORDER BY s.created_at DESC LIMIT 50").all(),
   env.DB.prepare("SELECT id,username,action,entity,entity_id,details,ip,created_at FROM activity_log ORDER BY id DESC LIMIT 500").all(),
   u.role==="owner" ? env.DB.prepare("SELECT id,username,role,is_active FROM users WHERE role='owner' OR username IN ('Admin','Reception') ORDER BY id").all() : Promise.resolve({results:[]})
  ]);
  return json({logins:logins.results||[],sessions:(sessions.results||[]).map(s=>({...s,device:device(s.user_agent),current:s.id===u.session_id})),activity:activity.results||[],users:users.results||[],currentUser:{username:u.username,role:u.role}});
 }catch(e){return json({error:"Security records unavailable: "+String(e.message||"database error")},500);}
}
export async function onRequestDelete({request,env}){
 try{
  const u=await auth(request,env);if(!u)return json({error:"Unauthorized"},401);
  if(u.role!=="owner")return json({error:"Owner access required"},403);
  const b=await request.json(),id=Number(b.session_id);if(!Number.isSafeInteger(id)||id<=0||id===u.session_id)return json({error:"Choose another valid session"},400);
  const target=await env.DB.prepare("SELECT id,user_id FROM sessions WHERE id=?").bind(id).first();if(!target)return json({error:"Session not found"},404);
  await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(id).run();
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'session_revoked','session',?,'Session ended from Security page')").bind(u.user_id,u.username,id).run();
  return json({success:true});
 }catch(e){return json({error:"Could not end session"},500);}
}