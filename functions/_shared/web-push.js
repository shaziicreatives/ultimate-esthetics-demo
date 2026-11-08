const enc = new TextEncoder();
const VAPID_PUBLIC_KEY = "BFhZkz2mE856noP-pvjj9MIuTG4YWp7iPO_LvYQhePmX4zwU7uHbMpQDh1BX7KYQXk4OlVMXJgUcVPfw9y83cqo";
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const fromB64u = value => {
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(s+"=".repeat((4-s.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function getSession(request,env){
  const match=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/);
  if(!match)return null;
  const token=decodeURIComponent(match[1]);
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(token));
  const hash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  return env.DB.prepare("SELECT s.user_id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.is_active=1").bind(hash).first();
}
async function deriveHKDF(ikm,salt,info,length){
  const key=await crypto.subtle.importKey("raw",ikm,"HKDF",false,["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt,info:enc.encode(info)},key,length*8));
}
async function vapidToken(endpoint,env){
  const url=new URL(endpoint), now=Math.floor(Date.now()/1000);
  const header=b64u(enc.encode(JSON.stringify({typ:"JWT",alg:"ES256"})));
  const claims=b64u(enc.encode(JSON.stringify({aud:url.origin,exp:now+12*60*60,sub:env.VAPID_SUBJECT||"https://ultimate-esthetics-demo.pages.dev/"})));
  const unsigned=header+"."+claims;
  const privateKey=await crypto.subtle.importKey("pkcs8",fromB64u(env.VAPID_PRIVATE_KEY),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,enc.encode(unsigned));
  return unsigned+"."+b64u(signature);
}
async function encryptPayload(subscription,payload){
  const uaPublic=fromB64u(subscription.p256dh), authSecret=fromB64u(subscription.auth);
  const receiverKey=await crypto.subtle.importKey("raw",uaPublic,{name:"ECDH",namedCurve:"P-256"},false,[]);
  const ephemeral=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:receiverKey},ephemeral.privateKey,256));
  const asPublic=new Uint8Array(await crypto.subtle.exportKey("raw",ephemeral.publicKey));
  const keyInfo=new Uint8Array([...enc.encode("WebPush: info\0"),...uaPublic,...asPublic]);
  const ikm=await deriveHKDF(shared,authSecret,new TextDecoder().decode(keyInfo),32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await deriveHKDF(ikm,salt,"Content-Encoding: aes128gcm\0",16);
  const nonce=await deriveHKDF(ikm,salt,"Content-Encoding: nonce\0",12);
  const plain=new Uint8Array([...enc.encode(JSON.stringify(payload)),2]);
  const aes=await crypto.subtle.importKey("raw",cek,{name:"AES-GCM"},false,["encrypt"]);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,tagLength:128},aes,plain));
  const recordSize=4096, header=new Uint8Array(16+4+1+asPublic.length);
  header.set(salt,0);
  new DataView(header.buffer).setUint32(16,recordSize);
  header[20]=asPublic.length; header.set(asPublic,21);
  const body=new Uint8Array(header.length+cipher.length);body.set(header);body.set(cipher,header.length);
  return body;
}
async function sendOne(subscription,payload,env){
  const body=await encryptPayload(subscription,payload);
  const token=await vapidToken(subscription.endpoint,env);
  return fetch(subscription.endpoint,{method:"POST",headers:{
    "Authorization":"vapid t="+token+", k="+env.VAPID_PUBLIC_KEY,
    "TTL":"86400","Urgency":"high","Content-Type":"application/octet-stream","Content-Encoding":"aes128gcm"
  },body});
}
export async function notifyClinicStaff(env,payload){
  if(!env.VAPID_PRIVATE_KEY||!env.DB)return {sent:0,skipped:true};
  const {results=[]}=await env.DB.prepare("SELECT ps.id,ps.endpoint,ps.p256dh,ps.auth FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.is_active=1 AND lower(u.role) IN ('owner','admin','reception','receptionist')").all();
  let sent=0;
  await Promise.all(results.map(async sub=>{
    try{
      const response=await sendOne(sub,payload,env);
      if(response.ok)sent++;
      else if(response.status===404||response.status===410)await env.DB.prepare("DELETE FROM push_subscriptions WHERE id=?").bind(sub.id).run();
    }catch(e){}
  }));
  return {sent};
}
export async function onRequestGetPush(context){
  const session=await getSession(context.request,context.env);
  if(!session)return json({error:"Unauthorized"},401);
  if(!context.env.VAPID_PRIVATE_KEY)return json({error:"Push notifications are not configured on this Preview yet."},503);
  const existing=await context.env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?").bind(session.user_id).first();
  return json({publicKey:VAPID_PUBLIC_KEY,subscribed:Number(existing?.n||0)>0});
}
export async function onRequestPostPush(context){
  const session=await getSession(context.request,context.env);
  if(!session)return json({error:"Unauthorized"},401);
  const body=await context.request.json().catch(()=>({}));
  const sub=body.subscription;
  if(!sub||!String(sub.endpoint||"").startsWith("https://")||!sub.keys?.p256dh||!sub.keys?.auth)return json({error:"Invalid push subscription."},400);
  if(!context.env.VAPID_PRIVATE_KEY)return json({error:"Push notifications are not configured on this Preview yet."},503);
  await context.env.DB.prepare("INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=CURRENT_TIMESTAMP").bind(session.user_id,sub.endpoint,sub.keys.p256dh,sub.keys.auth,String(context.request.headers.get("User-Agent")||"").slice(0,300)).run();
  try {
    const response=await sendOne({endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth},{title:"Background alerts connected",body:"This device successfully received a test push from Ultimate Esthetics Clinic Desk.",tag:"clinic-push-test",url:"/admin/index.html"},context.env);
    if(!response.ok){if(response.status===404||response.status===410)await context.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").bind(sub.endpoint,session.user_id).run();return json({error:"Push provider rejected the test notification ("+response.status+"). Please enable notifications again."},502);}
  } catch(e) { return json({error:"Could not send the test push. Check the VAPID secret and try again."},502); }
  return json({success:true,test_push_accepted:true});
}
export async function onRequestDeletePush(context){
  const session=await getSession(context.request,context.env);
  if(!session)return json({error:"Unauthorized"},401);
  const body=await context.request.json().catch(()=>({}));
  if(body.endpoint)await context.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").bind(session.user_id,String(body.endpoint)).run();
  else await context.env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id=?").bind(session.user_id).run();
  return json({success:true});
}
