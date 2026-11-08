import { notifyClinicStaff } from "../../_shared/web-push.js";
import { syncVisitToDrive, syncPatientToDrive } from "../../_shared/google-drive-sync.js";
async function session(request, env) {
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_token=([^;]+)/); if(!m)return null;
 const token=decodeURIComponent(m[1]); const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
 const h=Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("");
 return env.DB.prepare("SELECT s.user_id,u.username,u.email,u.role,u.doctor_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.is_active=1").bind(h).first();
}
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
export async function onRequestGet({request,env}) {
 const u=await session(request,env); if(!u)return json({error:"Unauthorized"},401);
 const doctorFilter=u.role==="doctor"?"WHERE v.doctor_id=?":"";
 const rows=await env.DB.prepare("SELECT v.*,p.name patient_name,p.phone,d.name doctor_name,COALESCE((SELECT SUM(amount) FROM payments WHERE visit_id=v.id),0) received FROM visits v JOIN patients p ON p.id=v.patient_id JOIN doctors d ON d.id=v.doctor_id "+doctorFilter+" ORDER BY v.created_at DESC LIMIT 500").bind(...(u.role==="doctor"?[u.doctor_id]:[])).all();
 const visits=[];
 for(const row of rows.results){
  const procedures=await env.DB.prepare("SELECT procedure_name,fee FROM visit_procedures WHERE visit_id=?").bind(row.id).all();
  const payments=await env.DB.prepare("SELECT amount,method,reference,created_at FROM payments WHERE visit_id=? ORDER BY created_at").bind(row.id).all();
  visits.push({...row,procedures:procedures.results,payments:payments.results});
 }
 const patientRows=await env.DB.prepare("SELECT p.id,p.name,p.phone,p.referred_by_patient_id,p.referral_notes,(SELECT rp.name FROM patients rp WHERE rp.id=p.referred_by_patient_id) referred_by_name,COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=p.id),0) billed,COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=p.id),0) received,(SELECT COUNT(*) FROM visits WHERE patient_id=p.id) visit_count,MAX((SELECT MAX(follow_up_date) FROM visits WHERE patient_id=p.id AND follow_up_date IS NOT NULL),(SELECT MAX(follow_up_date) FROM appointments WHERE patient_id=p.id AND follow_up_date IS NOT NULL)) follow_up_date FROM patients p ORDER BY p.name").all();
 const patients=patientRows.results.map(p=>({...p,balance:Math.max(0,p.billed-p.received)}));
 return json({visits,patients});
}
export async function onRequestPost(context) {
 const {request,env}=context;
 const u=await session(request,env);if(!u||u.role==="doctor")return json({error:"Unauthorized"},401);
 try {
  const b=await request.json(), appointmentId=Number(b.appointment_id), subtotal=Number(b.subtotal_amount ?? b.total_amount), discountType=String(b.discount_type||"none"), discountValue=Number(b.discount_value||0), procedures=Array.isArray(b.procedures)?b.procedures:[];
  if(!appointmentId||!Number.isSafeInteger(subtotal)||subtotal<0||!["none","percentage","fixed"].includes(discountType)||!Number.isFinite(discountValue)||discountValue<0||(discountType==="percentage"&&discountValue>100)||(discountType==="fixed"&&!Number.isSafeInteger(discountValue))||!procedures.length||procedures.some(p=>!String(p.name||"").trim()||!Number.isSafeInteger(Number(p.fee))||Number(p.fee)<0))return json({error:"Visit details invalid"},400);
  const discountAmount=discountType==="percentage"?Math.round(subtotal*discountValue/100):discountType==="fixed"?Math.min(subtotal,discountValue):0;
  const total=subtotal-discountAmount;
  const a=await env.DB.prepare("SELECT * FROM appointments WHERE id=?").bind(appointmentId).first();if(!a)return json({error:"Appointment not found"},404);
  if(a.status!=='confirmed'||!a.checked_in_at)return json({error:"Please check in the patient from the Patients page before saving the visit."},409);
  const existingVisit=await env.DB.prepare("SELECT id,invoice_number FROM visits WHERE appointment_id=?").bind(appointmentId).first();
  if(existingVisit)return json({error:"An invoice already exists for this visit.",visit_id:existingVisit.id,invoice_number:existingVisit.invoice_number},409);
  const old=await env.DB.prepare("SELECT COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=?),0) balance").bind(a.patient_id,a.patient_id).first();
  const previousBalance=Math.max(0,Number(old?.balance||0)), received=Number(b.received_now||0);
  if(!Number.isSafeInteger(received)||received<0||received>total+previousBalance)return json({error:"Received amount cannot exceed the previous balance plus this visit bill."},400);
  const seq=await env.DB.prepare("UPDATE invoice_sequence SET last_number=last_number+1 WHERE id=1 RETURNING last_number").first();
  if(!seq)return json({error:"Invoice sequence is not configured. Apply database migration 0007 first."},503);
  const invoiceNumber="UE-INV-"+String(seq.last_number);
  const inserted=await env.DB.prepare("INSERT INTO visits(appointment_id,patient_id,doctor_id,user_id,notes,total_amount,follow_up_date,invoice_number,subtotal_amount,discount_type,discount_value,discount_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(a.id,a.patient_id,a.doctor_id,u.user_id,String(b.notes||"").slice(0,5000),total,b.follow_up_date||null,invoiceNumber,subtotal,discountType,discountValue,discountAmount).run();
  const visitId=inserted.meta.last_row_id;
  const statements=procedures.map(p=>env.DB.prepare("INSERT INTO visit_procedures(visit_id,procedure_name,fee) VALUES(?,?,?)").bind(visitId,String(p.name).trim().slice(0,160),Number(p.fee)));
  if(received)statements.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(visitId,a.patient_id,received,String(b.payment_method||"cash").slice(0,30),String(b.payment_reference||"").slice(0,120)||null,u.user_id));
  statements.push(env.DB.prepare("UPDATE appointments SET status='done',follow_up_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.follow_up_date||null,a.id));
  await env.DB.batch(statements);
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'visit_saved','visit',?,?)").bind(u.user_id,u.username,visitId,"Previous "+previousBalance+", bill "+total+", received "+received).run();
  if(context.waitUntil)context.waitUntil(syncVisitToDrive(env,visitId));
  const push=notifyClinicStaff(env,{title:"Invoice saved",body:"A clinic visit invoice "+invoiceNumber+" has been saved.",tag:"invoice-saved-"+visitId,url:"/admin/index.html"});
  if(context.waitUntil)context.waitUntil(push);else await push;
  return json({success:true,visit_id:visitId,invoice_number:invoiceNumber,subtotal_amount:subtotal,discount_type:discountType,discount_value:discountValue,discount_amount:discountAmount,total_amount:total,previous_balance:previousBalance,balance:previousBalance+total-received},201);
 } catch(e){return json({error:"Visit save failed: "+String(e.message||"database error")},500);}
}
export async function onRequestPatch(context) {
 const {request,env}=context;
 const u=await session(request,env);if(!u||u.role==="doctor")return json({error:"Unauthorized"},401);
 try {
  const b=await request.json(),patientId=Number(b.patient_id),patientName=String(b.patient_name||"").trim(),patientPhone=String(b.patient_phone||"").trim();
  if(b.patient_id!==undefined&&(!Number.isSafeInteger(patientId)||patientId<1||patientName.length<2||patientName.length>120||patientPhone.replace(/\\D/g,"").length<10||patientPhone.length>24))return json({error:"Enter a valid patient name and phone number."},400);
  if(b.patient_id!==undefined&&!await env.DB.prepare("SELECT id FROM patients WHERE id=?").bind(patientId).first())return json({error:"Patient not found."},404);
  const id=Number(b.visit_id);
  if(!id){
   if(b.patient_id===undefined)return json({error:"Patient or invoice ID is required."},400);
   await env.DB.prepare("UPDATE patients SET name=?,phone=? WHERE id=?").bind(patientName,patientPhone,patientId).run();
   await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'patient_edited','patient',?,?)").bind(u.user_id,u.username,patientId,"Patient name and phone updated").run();
   if(context.waitUntil){
    context.waitUntil(syncPatientToDrive(env,patientId));
    const priorVisits=await env.DB.prepare("SELECT id FROM visits WHERE patient_id=? ORDER BY id").bind(patientId).all();
    for(const prior of priorVisits.results||[])context.waitUntil(syncVisitToDrive(env,prior.id));
   }
   return json({success:true,patient_id:patientId});
  }
  const subtotal=Number(b.subtotal_amount),discountType=String(b.discount_type||"none"),discountValue=Number(b.discount_value||0),procedures=Array.isArray(b.procedures)?b.procedures:[];
  if(!Number.isSafeInteger(subtotal)||subtotal<0||!["none","percentage","fixed"].includes(discountType)||!Number.isFinite(discountValue)||discountValue<0||(discountType==="percentage"&&discountValue>100)||(discountType==="fixed"&&!Number.isSafeInteger(discountValue))||!procedures.length||procedures.some(p=>!String(p.name||"").trim()||!Number.isSafeInteger(Number(p.fee))||Number(p.fee)<0))return json({error:"Invoice details are invalid."},400);
  if(procedures.reduce((n,p)=>n+Number(p.fee),0)!==subtotal)return json({error:"Subtotal must equal the sum of treatment charges."},400);
  const visit=await env.DB.prepare("SELECT * FROM visits WHERE id=?").bind(id).first();if(!visit)return json({error:"Invoice not found."},404);
  if(b.patient_id!==undefined&&Number(visit.patient_id)!==patientId)return json({error:"Patient does not match this invoice."},409);
  const discountAmount=discountType==="percentage"?Math.round(subtotal*discountValue/100):discountType==="fixed"?Math.min(subtotal,discountValue):0,total=subtotal-discountAmount;
  const paymentRows=await env.DB.prepare("SELECT id,amount FROM payments WHERE visit_id=? ORDER BY created_at,id").bind(id).all();
  const oldPaid=paymentRows.results.reduce((n,p)=>n+Number(p.amount||0),0);
  const receivedAmount=b.received_amount===undefined?oldPaid:Number(b.received_amount);
  if(!Number.isSafeInteger(receivedAmount)||receivedAmount<0||receivedAmount>total)return json({error:"Received amount must be a valid amount and cannot exceed the updated invoice total."},400);
  const statements=[
   env.DB.prepare("UPDATE visits SET subtotal_amount=?,discount_type=?,discount_value=?,discount_amount=?,total_amount=?,notes=?,follow_up_date=? WHERE id=?").bind(subtotal,discountType,discountValue,discountAmount,total,String(b.notes||"").slice(0,5000),b.follow_up_date||null,id),
   env.DB.prepare("DELETE FROM visit_procedures WHERE visit_id=?").bind(id),
   ...procedures.map(p=>env.DB.prepare("INSERT INTO visit_procedures(visit_id,procedure_name,fee) VALUES(?,?,?)").bind(id,String(p.name).trim().slice(0,160),Number(p.fee)))
  ];
  let remainingPaid=receivedAmount;
  for(const payment of paymentRows.results){
   const amount=Math.min(remainingPaid,Number(payment.amount||0));remainingPaid-=amount;
   statements.push(env.DB.prepare("UPDATE payments SET amount=?,method=? WHERE id=?").bind(amount,String(b.payment_method||"cash").slice(0,30),payment.id));
  }
  if(remainingPaid>0)statements.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(id,visit.patient_id,remainingPaid,String(b.payment_method||"cash").slice(0,30),null,u.user_id));
  if(b.patient_id!==undefined)statements.push(env.DB.prepare("UPDATE patients SET name=?,phone=? WHERE id=?").bind(patientName,patientPhone,patientId));
  if(visit.appointment_id)statements.push(env.DB.prepare("UPDATE appointments SET follow_up_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.follow_up_date||null,visit.appointment_id));
  await env.DB.batch(statements);
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'invoice_edited','visit',?,?)").bind(u.user_id,u.username,id,"Invoice total updated to "+total+(b.patient_id!==undefined?"; patient profile and booking history updated":"")).run();
  if(context.waitUntil)context.waitUntil(syncVisitToDrive(env,id));
  return json({success:true,visit_id:id,invoice_number:visit.invoice_number,total_amount:total,paid:receivedAmount,balance:Math.max(0,total-receivedAmount)});
 }catch(e){return json({error:"Invoice update failed: "+String(e.message||"database error")},500);}
}
