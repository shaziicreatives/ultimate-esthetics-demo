const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const enc=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function sha256(value){return hex(await crypto.subtle.digest("SHA-256",enc.encode(String(value))));}
export async function ownerSession(request,env){
 const match=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/);
 if(!match)return null;
 let token;try{token=decodeURIComponent(match[1]);}catch{return null;}
 const tokenHash=await sha256(token);
 const user=await env.DB.prepare("SELECT s.user_id,s.id session_id,u.username,u.role,u.is_active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND u.is_active=1").bind(tokenHash).first();
 if(!user)return null;
 if(user.role!=="owner"||String(user.username).toLowerCase()==="admin")return null;
 return user;
}
function requireConfig(env){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_DRIVE_TOKEN_KEY)throw new Error("Google Drive setup is incomplete. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_DRIVE_TOKEN_KEY in Cloudflare Pages secrets.");
}
async function cryptoKey(env){
 requireConfig(env);
 return crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",enc.encode(env.GOOGLE_DRIVE_TOKEN_KEY)),"AES-GCM",false,["encrypt","decrypt"]);
}
export async function encryptTokens(tokens,env){
 const iv=crypto.getRandomValues(new Uint8Array(12)),key=await cryptoKey(env);
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(JSON.stringify(tokens)));
 return b64(new Uint8Array([...iv,...new Uint8Array(cipher)]));
}
export async function decryptTokens(value,env){
 const all=unb64(value),iv=all.slice(0,12),cipher=all.slice(12),key=await cryptoKey(env);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher);
 return JSON.parse(new TextDecoder().decode(plain));
}
export function oauthRedirect(request){return new URL("/api/admin/drive/oauth/callback",request.url).toString();}
export async function googleRequest(env,tokens,path,options={}){
 let access=tokens.access_token;
 if(!access||!tokens.expiry_date||tokens.expiry_date<Date.now()+60000){
  if(!tokens.refresh_token)throw new Error("Google authorization expired. Reconnect the Google account.");
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
  const refreshed=await response.json();
  if(!response.ok)throw new Error("Google token refresh failed: "+(refreshed.error_description||refreshed.error||response.status));
  tokens={...tokens,...refreshed,refresh_token:tokens.refresh_token,expiry_date:Date.now()+Number(refreshed.expires_in||3600)*1000};
  await env.DB.prepare("UPDATE google_drive_connections SET encrypted_tokens=?,token_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(await encryptTokens(tokens,env),tokens.expiry_date).run();
  access=tokens.access_token;
 }
 const response=await fetch("https://www.googleapis.com"+path,{...options,headers:{Authorization:"Bearer "+access,...(options.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error("Google Drive API "+response.status+": "+(data.error?.message||"request failed"));
 return {data,tokens};
}
export async function getConnection(env){
 return env.DB.prepare("SELECT * FROM google_drive_connections WHERE id=1").first();
}
export async function driveError(error){return json({error:String(error?.message||"Google Drive request failed")},500);}
