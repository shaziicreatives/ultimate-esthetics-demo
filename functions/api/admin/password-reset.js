async function session(request, env) {
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\\s*)admin_token=([^;]+)/); if(!m)return null;
 const token=decodeURIComponent(m[1]); const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const h=Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
 return env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.doctor_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.is_active=1").bind(h).first();
}
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const hash=async v=>{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")};

export async function onRequestPost({request,env}) {
 let b;try{b=await request.json();}catch{return json({error:"Invalid request"},400);}
 const action=String(b.action||"request");
 if(action==="request"){
  const username=String(b.username||"").trim();
  const user=username?await env.DB.prepare("SELECT id,email FROM users WHERE username=? COLLATE NOCASE AND is_active=1").bind(username).first():null;
  // Keep the response generic so the endpoint does not disclose whether an account exists.
  if(user && user.email && env.RESEND_API_KEY && env.MAIL_FROM){
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join(""),tokenHash=await hash(raw),expires=new Date(Date.now()+3600000).toISOString().replace('T',' ').slice(0,19);
   await env.DB.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,?)").bind(user.id,tokenHash,expires).run();
   const link=new URL("/admin/reset-password.html?token="+encodeURIComponent(raw),new URL(request.url).origin).toString();
   const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:env.MAIL_FROM,to:[user.email],subject:"Ultimate Esthetics account password reset",html:"<p>Password reset requested for your Ultimate Esthetics account.</p><p><a href='"+link+"'>Reset password</a></p><p>This secure link expires in one hour and can be used once. If you did not request this, you can ignore this email.</p>"})});
   if(!mail.ok){await env.DB.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash).run();return json({error:"Email provider rejected the reset email. Check the Resend API key and verified sender address."},502);}
  } else if(user && (!env.RESEND_API_KEY || !env.MAIL_FROM)){
   return json({error:"Password reset email is not configured yet. The secure email sender must be connected before reset links can be delivered."},503);
  }
  return json({success:true,message:"If the owner account exists, a reset email has been sent."});
 }
 if(action==="consume"){
  const token=String(b.token||""),next=String(b.new_password||"");if(!token||next.length<10||!/[0-9]/.test(next))return json({error:"Invalid token or weak password."},400);
  const row=await env.DB.prepare("SELECT pr.id,pr.user_id FROM password_resets pr WHERE pr.token_hash=? AND pr.used_at IS NULL AND pr.expires_at>datetime('now')").bind(await hash(token)).first();if(!row)return json({error:"Reset link expired or already used."},400);
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,"0")).join(""),ph=await hash(next+salt);
  await env.DB.batch([env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ph,salt,row.user_id),env.DB.prepare("UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id),env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id)]);
  return json({success:true});
 }
 return json({error:"Invalid action"},400);
}
