import {ownerSession,json,getConnection,decryptTokens,googleRequest} from "../../../_shared/google-drive.js";

export async function onRequestGet({request,env}){
 const owner=await ownerSession(request,env);
 if(!owner)return json({error:"Owner access required"},403);
 const missing=["GOOGLE_API_KEY","GOOGLE_APP_ID"].filter(key=>!env[key]);
 if(missing.length)return json({error:"Google Picker is not configured yet.",missing_config:missing},503);
 try{
  const connection=await getConnection(env);
  if(!connection||connection.owner_user_id!==owner.user_id)return json({error:"Connect your Google account first."},409);
  const tokens=await decryptTokens(connection.encrypted_tokens,env);
  const account=await googleRequest(env,tokens,"/drive/v3/about?"+new URLSearchParams({fields:"user"}).toString());
  return json({
   access_token:account.tokens.access_token,
   developer_key:env.GOOGLE_API_KEY,
   app_id:String(env.GOOGLE_APP_ID),
   email:account.data.user?.emailAddress||connection.google_email
  });
 }catch(error){
  return json({error:String(error?.message||"Could not prepare the Google Drive folder picker.")},500);
 }
}
