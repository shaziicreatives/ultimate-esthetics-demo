export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    // Accept both the current public booking form and the original API field names.
    const patient_name = String(data.patient_name || data.name || "").trim();
    const phone = String(data.phone || "").trim();
    const doctor = String(data.doctor || data.doctor_id || data.doctor_name || "").trim();
    const service = String(data.service || data.treatment || "Consultation").trim();
    const appointment_date = String(data.appointment_date || data.date || "").trim();
    const appointment_time = String(data.appointment_time || data.time || "").trim();
    const db = context.env.DB;

    if (!db) return new Response(JSON.stringify({ success: false, error: "D1 database binding DB is missing." }), {
      status: 503, headers: { "Content-Type": "application/json" }
    });
    if (!patient_name || !phone || !doctor || !appointment_date || !appointment_time) {
      return new Response(JSON.stringify({ success: false, error: "Name, phone, doctor, date and time are required." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    const existing = await db.prepare(
      "SELECT id FROM appointments WHERE appointment_date = ? AND appointment_time = ? AND doctor = ? AND status NOT IN ('Rejected','Cancelled','rejected','cancelled')"
    ).bind(appointment_date, appointment_time, doctor).first();
    if (existing) return new Response(JSON.stringify({ success: false, error: "This time slot is already requested." }), {
      status: 409, headers: { "Content-Type": "application/json" }
    });

    const inserted = await db.prepare(
      "INSERT INTO appointments (patient_name, phone, doctor, service, appointment_date, appointment_time, status) VALUES (?, ?, ?, ?, ?, ?, 'Pending')"
    ).bind(patient_name, phone, doctor, service, appointment_date, appointment_time).run();

    return new Response(JSON.stringify({ success: true, id: inserted.meta?.last_row_id ?? null, message: "Appointment request received." }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: "Could not save appointment." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
