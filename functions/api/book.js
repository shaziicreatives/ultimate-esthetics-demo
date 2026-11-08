import { notifyClinicStaff } from "../_shared/web-push.js";
export async function onRequestPost(context) {
    try {
        const { env, request } = context;
        const data = await request.json();
        let { name, phone, countryCode, doctor_id, date, time, treatment } = data;

        if (!name || !phone || !doctor_id || !date || time === undefined) {
            return new Response(JSON.stringify({ error: "All required fields must be filled" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Strict time validation (Clinic hours: 11 to 19 i.e., 11:00 AM to 07:00 PM)
        const hourNum = parseInt(time, 10);
        if (isNaN(hourNum) || hourNum < 11 || hourNum > 19) {
            return new Response(JSON.stringify({ error: "Invalid time slot selected. Clinic hours are 11:00 AM to 07:00 PM." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Clean phone number and attach country code securely
        let cleanInput = phone.trim().replace(/\s+/g, '');
        if (cleanInput.startsWith('0')) {
            cleanInput = cleanInput.substring(1);
        }
        
        const prefix = countryCode || '+92';
        const finalPhone = prefix + cleanInput;

        // Check if patient already exists by phone
        let patientRes = await env.DB.prepare(
            "SELECT id FROM patients WHERE phone = ?"
        ).bind(finalPhone).first();

        let patient_id;
        if (patientRes) {
            patient_id = patientRes.id;
            await env.DB.prepare("UPDATE patients SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, patient_id).run();
        } else {
            const insertPatient = await env.DB.prepare(
                "INSERT INTO patients (name, phone) VALUES (?, ?)"
            ).bind(name, finalPhone).run();
            patient_id = insertPatient.meta.last_row_id;
        }

        // Ensure time is formatted correctly as string (e.g., '14:00')
        const timeStr = String(hourNum).padStart(2, '0') + ':00';

        // Insert appointment with pending status
        const inserted = await env.DB.prepare(
            "INSERT INTO appointments (doctor_id, patient_id, date, time, treatment, status, source) VALUES (?, ?, ?, ?, ?, 'pending', 'website')"
        ).bind(doctor_id, patient_id, date, timeStr, treatment || null).run();
        const notify = notifyClinicStaff(env, {
            title: "New appointment request",
            body: "A new website booking is waiting for review in Clinic Desk.",
            tag: "appointment-request-" + inserted.meta.last_row_id,
            url: "/admin/index.html"
        });
        if (context.waitUntil) context.waitUntil(notify); else await notify;

        return new Response(JSON.stringify({ 
            success: true, 
            message: "Appointment requested successfully!", 
            status: "pending" 
        }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed") || err.message.includes("uq_active_slot")) {
            return new Response(JSON.stringify({ error: "This slot is already booked or pending. Please choose another time." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }
        return new Response(JSON.stringify({ error: "An unexpected error occurred while processing your booking. Please try again." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
