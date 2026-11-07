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
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: "Database binding DB missing" }, 503);
    const session = await getSession(request, env);
    if (!session || session.role === "doctor") return json({ error: "Unauthorized" }, 401);
    const body = await request.json();
    const name = String(body.name || "").trim();
    const digits = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const doctorId = Number(body.doctor_id);
    const date = String(body.date || "");
    const time = String(body.time || "");
    const treatment = String(body.treatment || "").trim();
    if (!name || digits.length !== 10 || !Number.isSafeInteger(doctorId) || doctorId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json({ error: "Patient, phone, doctor, valid date aur time zaroori hain." }, 400);
    const doctor = await env.DB.prepare("SELECT id FROM doctors WHERE id = ? AND is_active = 1").bind(doctorId).first();
    if (!doctor) return json({ error: "Selected doctor is unavailable." }, 400);
    const phone = "92" + digits;
    let patient = await env.DB.prepare("SELECT id FROM patients WHERE phone = ?").bind(phone).first();
    if (patient) {
      await env.DB.prepare("UPDATE patients SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, patient.id).run();
    } else {
      const insertedPatient = await env.DB.prepare("INSERT INTO patients (name, phone) VALUES (?, ?)").bind(name, phone).run();
      patient = { id: insertedPatient.meta.last_row_id };
    }
    const inserted = await env.DB.prepare("INSERT INTO appointments (doctor_id, patient_id, date, time, treatment, status, source, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'manual', ?)").bind(doctorId, patient.id, date, time, treatment || null, session.user_id).run();
    await env.DB.prepare("INSERT INTO activity_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, 'manual_appointment_created', 'appointment', ?, ?, ?)").bind(session.user_id, session.username, inserted.meta.last_row_id, "Manual appointment for patient " + patient.id, request.headers.get("CF-Connecting-IP") || "").run();
    return json({ success: true, appointment_id: inserted.meta.last_row_id, patient_id: patient.id });
  } catch (error) {
    if (String(error.message || "").includes("uq_active_slot") || String(error.message || "").includes("UNIQUE constraint failed")) return json({ error: "Yeh slot pehle se booked hai. Doosra time select karein." }, 409);
    return json({ error: "Manual appointment save nahi hui." }, 500);
  }
}
