export async function onRequestPost(context) {
    try {
        const { env, request } = context;
        const data = await request.json();
        const { name, phone, doctor_id, date, time, treatment } = data;

        if (!name || !phone || !doctor_id || !date || !time) {
            return new Response(JSON.stringify({ error: "All required fields must be filled" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Phone normalization logic (+92 standard for local, international allowed)
        let cleanPhone = phone.trim().replace(/\s+/g, '');
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '+92' + cleanPhone.substring(1);
        }

        // Check if patient already exists by normalized phone
        let patientRes = await env.DB.prepare(
            "SELECT id FROM patients WHERE phone = ?"
        ).bind(cleanPhone).first();

        let patient_id;
        if (patientRes) {
            patient_id = patientRes.id;
            // Update name if changed
            await env.DB.prepare("UPDATE patients SET name = ? WHERE id = ?").bind(name, patient_id).run();
        } else {
            const insertPatient = await env.DB.prepare(
                "INSERT INTO patients (name, phone) VALUES (?, ?)"
            ).bind(name, cleanPhone).run();
            patient_id = insertPatient.meta.last_row_id;
        }

        // Insert appointment with default 'pending' status
        await env.DB.prepare(
            "INSERT INTO appointments (doctor_id, patient_id, date, time, treatment, status) VALUES (?, ?, ?, ?, ?, 'pending')"
        ).bind(doctor_id, patient_id, date, time, treatment || null).run();

        return new Response(JSON.stringify({ success: true, message: "Appointment requested successfully!" }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (err) {
        if (err.message.includes("UNIQUE constraint failed") || err.message.includes("idx_unique_active_slot")) {
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
