export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { patient_name, phone, doctor, service, appointment_date, appointment_time } = data;
    
    // Cloudflare D1 Database binding
    const db = context.env.DB;

    if (!patient_name || !phone || !appointment_date || !appointment_time) {
      return new Response(JSON.stringify({ success: false, error: "Tamam zaroori fields pur karein!" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Check for double booking
    const existing = await db.prepare(
      "SELECT * FROM appointments WHERE appointment_date = ? AND appointment_time = ? AND doctor = ? AND status != 'Rejected'"
    ).bind(appointment_date, appointment_time, doctor).first();
    
    if (existing) {
      return new Response(JSON.stringify({ success: false, error: "Yeh time slot pehle hi book ho chuki hai!" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Insert new appointment into D1 Database
    await db.prepare(
      "INSERT INTO appointments (patient_name, phone, doctor, service, appointment_date, appointment_time, status) VALUES (?, ?, ?, ?, ?, ?, 'Pending')"
    ).bind(patient_name, phone, doctor, service || "Consultation", appointment_date, appointment_time).run();

    return new Response(JSON.stringify({ success: true, message: "Appointment successfully requested!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
