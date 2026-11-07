export async function onRequestPost(context) {
    try {
        const { env, request } = context;
        const data = await request.json();
        let { name, phone, countryCode, doctor_id, date, time, treatment } = data;

        if (!name || !phone || !doctor_id || !date || !time) {
            return new Response(JSON.stringify({ error: "All required fields must be filled" }), {
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
        const timeStr = String(time).padStart(2, '0') + ':00';

        // Insert appointment
        await env.DB.prepare(
            "INSERT INTO appointments (doctor_id, patient_id, date, time, treatment, status, source) VALUES (?, ?, ?, ?, ?, 'pending', 'website')"
        ).bind(doctor_id, patient_id, date, timeStr, treatment || null).run();

        return new Response(JSON.stringify({ success: true, message: "Appointment requested successfully!" }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed") || err.message.includes("uq_active_slot")) {
            return new Response(JSON.stringify({ error: "This slot is already booked or pending. Please choose another time." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
