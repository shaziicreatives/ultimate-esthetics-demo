async function session(request, env) {
 const m=(request.headers.get("Cookie")||"").match(/(?:^|;\\s*)admin_token=([^;]+)/); if(!m)return null;
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
 const patientRows=await env.DB.prepare("SELECT p.id,p.name,p.phone,COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=p.id),0) billed,COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=p.id),0) received,(SELECT COUNT(*) FROM visits WHERE patient_id=p.id) visit_count,(SELECT MAX(follow_up_date) FROM visits WHERE patient_id=p.id AND follow_up_date IS NOT NULL) follow_up_date FROM patients p ORDER BY p.name").all();
 const patients=patientRows.results.map(p=>({...p,balance:Math.max(0,p.billed-p.received)}));
 return json({visits,patients});
}
export async function onRequestPost({request,env}) {
 const u=await session(request,env);if(!u||u.role==="doctor")return json({error:"Unauthorized"},401);
 try {
  const b=await request.json(), appointmentId=Number(b.appointment_id), total=Number(b.total_amount), procedures=Array.isArray(b.procedures)?b.procedures:[];
  if(!appointmentId||!Number.isSafeInteger(total)||total<0||!procedures.length||procedures.some(p=>!String(p.name||"").trim()||!Number.isSafeInteger(Number(p.fee))||Number(p.fee)<0))return json({error:"Visit details invalid"},400);
  const a=await env.DB.prepare("SELECT * FROM appointments WHERE id=?").bind(appointmentId).first();if(!a)return json({error:"Appointment not found"},404);
  const old=await env.DB.prepare("SELECT COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=?),0) balance").bind(a.patient_id,a.patient_id).first();
  const previousBalance=Math.max(0,Number(old?.balance||0)), received=Number(b.received_now||0);
  if(!Number.isSafeInteger(received)||received<0||received>total+previousBalance)return json({error:"Received amount cannot exceed the previous balance plus this visit bill."},400);
  const inserted=await env.DB.prepare("INSERT INTO visits(appointment_id,patient_id,doctor_id,user_id,notes,total_amount,follow_up_date) VALUES(?,?,?,?,?,?,?)").bind(a.id,a.patient_id,a.doctor_id,u.user_id,String(b.notes||"").slice(0,5000),total,b.follow_up_date||null).run();
  const visitId=inserted.meta.last_row_id;
  const statements=procedures.map(p=>env.DB.prepare("INSERT INTO visit_procedures(visit_id,procedure_name,fee) VALUES(?,?,?)").bind(visitId,String(p.name).trim().slice(0,160),Number(p.fee)));
  if(received)statements.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(visitId,a.patient_id,received,String(b.payment_method||"cash").slice(0,30),String(b.payment_reference||"").slice(0,120)||null,u.user_id));
  statements.push(env.DB.prepare("UPDATE appointments SET status='done',follow_up_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.follow_up_date||null,a.id));
  await env.DB.batch(statements);
  await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details) VALUES(?,?,'visit_saved','visit',?,?)").bind(u.user_id,u.username,visitId,"Previous "+previousBalance+", bill "+total+", received "+received).run();
  return json({success:true,visit_id:visitId,previous_balance:previousBalance,balance:previousBalance+total-received},201);
 } catch(e){return json({error:"Visit save failed: "+String(e.message||"database error")},500);}
}