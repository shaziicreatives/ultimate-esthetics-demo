import {ownerSession,json,getConnection,decryptTokens,encryptTokens,googleRequest} from "../../../_shared/google-drive.js";
async function folderRequest(env,tokens,method,body){
 return googleRequest(env,tokens,"/drive/v3/files",{method,headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
}
export async function onRequestGet({request,env}){
 const user=await ownerSession(request,env);if(!user)return json({error:"Owner access required"},403);
 try{
  const c=await getConnection(env);
  if(!c)return json({connected:false,configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_DRIVE_TOKEN_KEY),message:"Connect a Google account to continue."});
  const url=new URL(request.url),parent=url.searchParams.get("parent");
  if(parent){
   if(parent!=="root"&&!c.root_folder_id)return json({error:"Choose a clinic root folder first."},409);
   const tokens=await decryptTokens(c.encrypted_tokens,env);
   const q="'"+parent.replace(/'/g,"\\'")+"' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
   const result=await googleRequest(env,tokens,"/drive/v3/files?"+new URLSearchParams({q,fields:"files(id,name,mimeType,parents)",pageSize:"100",orderBy:"name",supportsAllDrives:"true",includeItemsFromAllDrives:"true"}).toString());
   return json({connected:true,folders:result.data.files||[]});
  }
  return json({connected:true,email:c.google_email,root_folder_id:c.root_folder_id,root_folder_name:c.root_folder_name,selected_drive_id:c.selected_drive_id,selected_drive_name:c.selected_drive_name,auto_save_invoice_pdf:!!c.auto_save_invoice_pdf,auto_save_patient_record:!!c.auto_save_patient_record,auto_save_visit_record:!!c.auto_save_visit_record,last_sync_at:c.last_sync_at,connected_at:c.connected_at});
 }catch(e){return json({error:String(e.message||"Google Drive status unavailable")},500);}
}
export async function onRequestPost({request,env}){
 const user=await ownerSession(request,env);if(!user)return json({error:"Owner access required"},403);
 try{
  const b=await request.json(),action=String(b.action||""),c=await getConnection(env);
  if(action==="disconnect"){
   if(c)await env.DB.prepare("DELETE FROM google_drive_connections WHERE id=1 AND owner_user_id=?").bind(user.user_id).run();
   await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,details) VALUES(?,?,'google_drive_disconnected','integration','Google Drive disconnected; clinic data and saved Drive references retained')").bind(user.user_id,user.username).run();
   return json({success:true,message:"Google Drive disconnected. Existing clinic records and saved file references were retained."});
  }
  if(!c)return json({error:"Connect Google Drive first."},409);
  if(c.owner_user_id!==user.user_id)return json({error:"This Drive connection belongs to another Owner account."},403);
  if(action==="settings"){
   const invoice=b.auto_save_invoice_pdf===undefined?c.auto_save_invoice_pdf:(b.auto_save_invoice_pdf?1:0);
   const patient=b.auto_save_patient_record===undefined?c.auto_save_patient_record:(b.auto_save_patient_record?1:0);
   const visit=b.auto_save_visit_record===undefined?c.auto_save_visit_record:(b.auto_save_visit_record?1:0);
   await env.DB.prepare("UPDATE google_drive_connections SET auto_save_invoice_pdf=?,auto_save_patient_record=?,auto_save_visit_record=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(invoice,patient,visit).run();
   return json({success:true});
  }
  const tokens=await decryptTokens(c.encrypted_tokens,env);
  if(action==="create_root"){
   if(c.root_folder_id)return json({error:"A clinic root folder is already selected. Disconnecting or changing accounts does not delete its existing Drive folder."},409);
   const name=String(b.name||"Ultimate Esthetics Clinic").trim().slice(0,100);
   if(!name)return json({error:"Enter a folder name."},400);
   const made=await folderRequest(env,tokens,"POST",{name,mimeType:"application/vnd.google-apps.folder"});
   await env.DB.prepare("UPDATE google_drive_connections SET root_folder_id=?,root_folder_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(made.data.id,made.data.name).run();
   return json({success:true,folder:{id:made.data.id,name:made.data.name}});
  }
  if(action==="select_root"){
   const id=String(b.folder_id||"").trim();if(!id)return json({error:"Select a folder."},400);
   const found=await googleRequest(env,tokens,"/drive/v3/files/"+encodeURIComponent(id)+"?"+new URLSearchParams({fields:"id,name,mimeType,trashed"}).toString());
   if(found.data.mimeType!=="application/vnd.google-apps.folder"||found.data.trashed)return json({error:"Choose an accessible Google Drive folder."},400);
   await env.DB.prepare("UPDATE google_drive_connections SET root_folder_id=?,root_folder_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(found.data.id,found.data.name).run();
   return json({success:true,folder:{id:found.data.id,name:found.data.name}});
  }
  if(action==="create_folder"){
   if(!c.root_folder_id)return json({error:"Create or select the clinic root folder first."},409);
   const name=String(b.name||"").trim().slice(0,100),parent=String(b.parent_id||c.root_folder_id);
   if(!name)return json({error:"Enter a folder name."},400);
   if(parent!==c.root_folder_id){
    const exists=await env.DB.prepare("SELECT folder_id FROM google_drive_patient_folders WHERE folder_id=? UNION SELECT folder_id FROM google_drive_visit_folders WHERE folder_id=?").bind(parent,parent).first();
    if(!exists)return json({error:"Parent folder is not a clinic-managed folder."},403);
   }
   const made=await folderRequest(env,tokens,"POST",{name,mimeType:"application/vnd.google-apps.folder",parents:[parent]});
   return json({success:true,folder:{id:made.data.id,name:made.data.name}});
  }
  return json({error:"Unsupported Google Drive action."},400);
 }catch(e){return json({error:String(e.message||"Google Drive operation failed")},500);}
}
