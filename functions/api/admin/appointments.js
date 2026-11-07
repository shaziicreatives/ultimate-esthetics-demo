import { hasAdminSession, json } from "./_auth.js";

const STATUS_OUT = { "Pending": "pending", "Confirmed": "confirmed", "Rejected": "rejected", "Cancelled": "cancelled", "Done": "done", "No Show": "no_show" };
const STATUS_IN = { pending: "Pending", confirmed: "Confirmed", rejected: "Rejected", cancelled: "Cancelled", done: "Done", no_show: "No Show" };

export async function onRequestGet({ request, env }) {
  if (!(await hasAdminSession(request, env))) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.DB) return json({ success: false, error: "D1 database binding DB is missing." }, 503);
  try {
    const result = await env.DB.prepare(
      "SELECT id, patient_name, phone, doctor, service, appointment_date, appointment_time, status, created_at FROM appointments ORDER BY appointment_date DESC, appointment_time DESC, id DESC"
    ).all();
    const appointments = (result.results || []).map(a => ({
      id: a.id, patient_id: a.id, patient_name: a.patient_name, patient_phone: a.phone,
      doctor_id: a.doctor, doctor_name: a.doctor, date: a.appointment_date,
      time: a.appointment_time, treatment: a.service || "", status: STATUS_OUT[a.status] || String(a.status || "pending").toLowerCase().replace(/\s+/g, "_"),
      source: "website", follow_up_date: null, created_at: a.created_at
    }));
    return json({ success: true, appointments });
  } catch (error) {
    return json({ success: false, error: "Could not load appointments from D1." }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!(await hasAdminSession(request, env))) return json({ success: false, error: "Unauthorized" }, 401);
  if (!env.DB) return json({ success: false, error: "D1 database binding DB is missing." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: "Invalid JSON body." }, 400); }
  const id = Number(body.id), status = STATUS_IN[String(body.status || "").toLowerCase()];
  if (!Number.isSafeInteger(id) || id < 1 || !status) return json({ success: false, error: "Valid appointment id and status are required." }, 400);
  try {
    const result = await env.DB.prepare("UPDATE appointments SET status = ? WHERE id = ?").bind(status, id).run();
    if (!result.meta || result.meta.changes === 0) return json({ success: false, error: "Appointment not found." }, 404);
    return json({ success: true, id, status: STATUS_OUT[status] });
  } catch (error) {
    return json({ success: false, error: "Could not update appointment status." }, 500);
  }
}
