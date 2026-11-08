import { notifyClinicStaff } from "../../_shared/web-push.js";
async function getSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  return env.DB.prepare("SELECT s.user_id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.is_active = 1").bind(hash).first();
}
const json = (data, status=200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return json({ error: "Database binding DB missing" }, 503);
    const session = await getSession(request, env);
    if (!session || session.role === "doctor") return json({ error: "Unauthorized" }, 401);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const rawPhone = String(body.phone || "").trim();
    const compactPhone = rawPhone.replace(/[\s()-]/g, "");
    const phoneDigits = compactPhone.replace(/\D/g, "");
    const validPhone = /^\+923\d{9}$/.test(compactPhone) || /^03\d{9}$/.test(phoneDigits);
    const digits = phoneDigits.slice(-10);
    const doctorId = Number(body.doctor_id);
    const date = String(body.date || "");
    const time = String(body.time || "");
    const treatment = String(body.treatment || "").trim();
    const followUpDate = String(body.follow_up_date || "").trim();
    if (followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) return json({ error: "Follow-up date is invalid." }, 400);
    if (!name || !validPhone || digits.length !== 10 || !Number.isSafeInteger(doctorId) || doctorId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({ error: "A valid Pakistani mobile number, patient name, doctor, date, and time are required." }, 400);
    const doctor = await env.DB.prepare("SELECT id FROM doctors WHERE id = ? AND is_active = 1").bind(doctorId).first();
    if (!doctor) return json({ error: "Selected doctor is unavailable." }, 400);
    const referralId = body.referred_by_patient_id ? Number(body.referred_by_patient_id) : null;
    const referralNotes = String(body.referral_notes || "").trim().slice(0,500);
    const manualSubtotal = body.manual_subtotal === undefined || body.manual_subtotal === null || body.manual_subtotal === "" ? null : Number(body.manual_subtotal);
    const discountType = String(body.discount_type || "none"), discountValue = Number(body.discount_value || 0), received = Number(body.received_now || 0);
    if (manualSubtotal !== null && (!Number.isSafeInteger(manualSubtotal) || manualSubtotal < 0 || !["none","percentage","fixed"].includes(discountType) || !Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percentage" && discountValue > 100) || (discountType === "fixed" && !Number.isSafeInteger(discountValue)))) return json({ error: "Manual invoice amount or discount is invalid." }, 400);
    const discountAmount = manualSubtotal === null ? 0 : discountType === "percentage" ? Math.round(manualSubtotal * discountValue / 100) : discountType === "fixed" ? Math.min(manualSubtotal, discountValue) : 0;
    const netTotal = manualSubtotal === null ? 0 : manualSubtotal - discountAmount;
    if (!Number.isSafeInteger(received) || received < 0) return json({ error: "Received amount must be zero or a positive whole number." }, 400);
    if (referralId && (!Number.isSafeInteger(referralId) || !await env.DB.prepare("SELECT id FROM patients WHERE id=?").bind(referralId).first())) return json({ error: "Select a valid referring patient." }, 400);
    if (manualSubtotal !== null && !await env.DB.prepare("SELECT id FROM invoice_sequence WHERE id=1").first()) return json({ error: "Invoice sequence is not configured. Apply migration 0007 first." }, 503);
    const phone = "+92" + digits;
    let patient = await env.DB.prepare("SELECT id FROM patients WHERE phone = ?").bind(phone).first();
    if (!patient && manualSubtotal === null && received > 0) return json({ error: "This is a new patient with no outstanding invoice to pay." }, 400);
    if (patient) {
      await env.DB.prepare("UPDATE patients SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, patient.id).run();
    } else {
      const insertedPatient = await env.DB.prepare("INSERT INTO patients (name, phone) VALUES (?, ?)").bind(name, phone).run();
      patient = { id: insertedPatient.meta.last_row_id };
    }
    const oldBalanceRow = await env.DB.prepare("SELECT COALESCE((SELECT SUM(total_amount) FROM visits WHERE patient_id=?),0)-COALESCE((SELECT SUM(amount) FROM payments WHERE patient_id=?),0) balance").bind(patient.id,patient.id).first();
    const previousBalance = Math.max(0,Number(oldBalanceRow?.balance||0));
    const outstandingInvoices = await env.DB.prepare("SELECT v.id,MAX(0,v.total_amount-COALESCE((SELECT SUM(amount) FROM payments WHERE visit_id=v.id),0)) balance FROM visits v WHERE v.patient_id=? AND v.total_amount>COALESCE((SELECT SUM(amount) FROM payments WHERE visit_id=v.id),0) ORDER BY v.created_at ASC").bind(patient.id).all();
    if (manualSubtotal === null && received > previousBalance) return json({ error: "Payment cannot exceed this patient's outstanding balance of Rs " + previousBalance + "." }, 400);
    if (manualSubtotal !== null && received > previousBalance + netTotal) return json({ error: "Received amount cannot exceed the previous balance plus this discounted invoice total." }, 400);
    if (manualSubtotal === null && received > 0 && !outstandingInvoices.results.length) return json({ error: "No outstanding invoice was found for this patient." }, 400);
    if (referralId === Number(patient.id)) return json({ error: "A patient cannot refer themselves." }, 400);
    const inserted = await env.DB.prepare("INSERT INTO appointments (doctor_id, patient_id, date, time, treatment, status, source, created_by, follow_up_date) VALUES (?, ?, ?, ?, ?, 'confirmed', 'manual', ?, ?)").bind(doctorId, patient.id, date, time, treatment || null, session.user_id, followUpDate || null).run();
    if (referralId || referralNotes) await env.DB.prepare("UPDATE patients SET referred_by_patient_id=?, referral_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(referralId, referralNotes || null, patient.id).run();
    let manualInvoice = null;
    if (manualSubtotal === null && received > 0) {
      let paymentLeft = received;
      const paymentBatch = [];
      for (const invoice of outstandingInvoices.results) {
        if (paymentLeft <= 0) break;
        const allocation = Math.min(paymentLeft, Number(invoice.balance||0));
        if (allocation > 0) paymentBatch.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(invoice.id,patient.id,allocation,String(body.payment_method||"cash").slice(0,30),String(body.payment_reference||"").slice(0,120)||null,session.user_id));
        paymentLeft -= allocation;
      }
      if (paymentBatch.length) await env.DB.batch(paymentBatch);
      await env.DB.prepare("UPDATE appointments SET status='done',checked_in_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(inserted.meta.last_row_id).run();
      manualInvoice = { payment_only: true, received, previous_balance: previousBalance, balance: previousBalance-received };
    }
    if (manualSubtotal !== null) {
      const seq = await env.DB.prepare("UPDATE invoice_sequence SET last_number=last_number+1 WHERE id=1 RETURNING last_number").first();
      if (!seq) return json({ error: "Invoice sequence is not configured. Apply migration 0007 first." }, 503);
      const invoiceNumber = "UE-INV-" + String(seq.last_number);
      const visit = await env.DB.prepare("INSERT INTO visits(appointment_id,patient_id,doctor_id,user_id,notes,total_amount,follow_up_date,invoice_number,subtotal_amount,discount_type,discount_value,discount_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(inserted.meta.last_row_id,patient.id,doctorId,session.user_id,String(body.notes||"").slice(0,5000),netTotal,followUpDate||null,invoiceNumber,manualSubtotal,discountType,discountValue,discountAmount).run();
      const visitId = visit.meta.last_row_id;
      const paymentStatements = [];
      if (treatment) paymentStatements.push(env.DB.prepare("INSERT INTO visit_procedures(visit_id,procedure_name,fee) VALUES(?,?,?)").bind(visitId,treatment.slice(0,160),manualSubtotal));
      else paymentStatements.push(env.DB.prepare("INSERT INTO visit_procedures(visit_id,procedure_name,fee) VALUES(?,?,?)").bind(visitId,"Manual visit",manualSubtotal));
      let paymentLeft = received;
      for (const invoice of outstandingInvoices.results) {
        if (paymentLeft <= 0) break;
        const allocation = Math.min(paymentLeft, Number(invoice.balance||0));
        if (allocation > 0) paymentStatements.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(invoice.id,patient.id,allocation,String(body.payment_method||"cash").slice(0,30),String(body.payment_reference||"").slice(0,120)||null,session.user_id));
        paymentLeft -= allocation;
      }
      if (paymentLeft > 0) paymentStatements.push(env.DB.prepare("INSERT INTO payments(visit_id,patient_id,amount,method,reference,received_by) VALUES(?,?,?,?,?,?)").bind(visitId,patient.id,paymentLeft,String(body.payment_method||"cash").slice(0,30),String(body.payment_reference||"").slice(0,120)||null,session.user_id));
      paymentStatements.push(env.DB.prepare("UPDATE appointments SET status='done',checked_in_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(inserted.meta.last_row_id));
      await env.DB.batch(paymentStatements);
      manualInvoice = { visit_id: visitId, invoice_number: invoiceNumber, total_amount: netTotal, received, previous_balance: previousBalance, balance: previousBalance + netTotal - received };
    }
    await env.DB.prepare("INSERT INTO activity_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, 'manual_appointment_created', 'appointment', ?, ?, ?)").bind(session.user_id, session.username, inserted.meta.last_row_id, "Manual appointment for patient " + patient.id, request.headers.get("CF-Connecting-IP") || "").run();
    const notify = notifyClinicStaff(env, {
      title: "Appointment added",
      body: "A new appointment was added to Clinic Desk.",
      tag: "appointment-added-" + inserted.meta.last_row_id,
      url: "/admin/index.html"
    });
    if (context.waitUntil) context.waitUntil(notify); else await notify;
    return json({ success: true, appointment_id: inserted.meta.last_row_id, patient_id: patient.id, invoice: manualInvoice });
  } catch (error) {
    if (String(error.message || "").includes("uq_active_slot") || String(error.message || "").includes("UNIQUE constraint failed")) return json({ error: "This time slot is already booked. Please select another time." }, 409);
    return json({ error: "Unable to save the manual appointment." }, 500);
  }
}
