async function session(request, env) {
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\\s*)admin_token=([^;]+)/); if(!m)return null;
 const token=decodeURIComponent(m[1]); const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const h=Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
 return env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.doctor_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.is_active=1").bind(h).first();
}
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};

export async function onRequestPost({request,env}) {
 const u=await session(request,env);if(!u)return json({error:"Unauthorized"},401);
 const b=await request.json(),current=String(b.current_password||""),next=String(b.new_password||"");
 if(next.length<10||!/[0-9]/.test(next))return json({error:"New password must be 10+ characters and include a number."},400);
 const row=await env.DB.prepare("SELECT id,password_hash,password_salt FROM users WHERE id=?").bind(u.user_id).first();
 if(!row||await hash(current+row.password_salt)!==row.password_hash)return json({error:"Current password is incorrect."},400);
 const saltBytes=crypto.getRandomValues(new Uint8Array(16)),salt=Array.from(saltBytes).map(x=>x.toString(16).padStart(2,"0")).join(""),ph=await hash(next+salt);
 await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ph,salt,u.user_id).run();
 await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.user_id).run();
 await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'password_changed','user','Password changed; all sessions revoked')").bind(u.user_id,u.username).run();
 return new Response(JSON.stringify({success:true}),{headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":"admin_token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax"}});
}