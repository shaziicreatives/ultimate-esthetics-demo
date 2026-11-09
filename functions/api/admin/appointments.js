import { getAdminSession } from "../../_shared/admin-session.js";
import { notifyClinicStaff } from "../../_shared/web-push.js";
import { syncPatientToDrive } from "../../_shared/google-drive-sync.js";
export async function onRequestGet(context) {
    try {
        const { env, request } = context;
        const session = await getAdminSession(request, env);
        if (!session) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }

        let query = `
            SELECT a.*, p.name as patient_name, p.phone as patient_phone, d.name as doctor_name,
                   dt.token AS daily_token, dt.clinic_date AS token_date
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors d ON a.doctor_id = d.id
            LEFT JOIN appointment_daily_tokens dt ON dt.appointment_id = a.id
        `;

        let bindings = [];
        if (session.role === 'doctor') {
            query += " WHERE a.doctor_id = ?";
            bindings.push(session.doctor_id);
        }

        query += " ORDER BY a.date DESC, a.time DESC LIMIT 1000";

        const { results } = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({ appointments: results }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
}

export async function onRequestPatch(context) {
    try {
        const { env, request } = context;
        const session = await getAdminSession(request, env);
        if (!session || session.role === 'doctor') {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }

        const { id, status, check_in } = await request.json();
        if (id && typeof check_in === 'boolean') {
            const beforeCheck = await env.DB.prepare("SELECT id,status FROM appointments WHERE id=?").bind(id).first();
            if (!beforeCheck) return new Response(JSON.stringify({error:"Appointment not found"}),{status:404,headers:{"Content-Type":"application/json"}});
            if (beforeCheck.status !== 'confirmed') return new Response(JSON.stringify({error:"Only confirmed appointments can be checked in."}),{status:409,headers:{"Content-Type":"application/json"}});
            if (check_in) {
                const existingToken = await env.DB.prepare("SELECT token FROM appointment_daily_tokens WHERE appointment_id=?").bind(id).first();
                if (!existingToken) {
                    const clinicDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
                    const counter = await env.DB.prepare("INSERT INTO daily_token_counters(clinic_date,last_number) VALUES(?,1) ON CONFLICT(clinic_date) DO UPDATE SET last_number=last_number+1 RETURNING last_number").bind(clinicDate).first();
                    await env.DB.prepare("INSERT INTO appointment_daily_tokens(appointment_id,clinic_date,token) VALUES(?,?,?)").bind(id, clinicDate, Number(counter.last_number)).run();
                }
            }
            await env.DB.prepare("UPDATE appointments SET checked_in_at = " + (check_in ? "CURRENT_TIMESTAMP" : "NULL") + ", updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
            await env.DB.prepare("INSERT INTO activity_log(user_id,username,action,entity,entity_id,details,ip) VALUES(?,?,'patient_checkin','appointment',?,?,?)").bind(session.user_id,session.username,id,check_in?'Checked in':'Check-in undone',request.headers.get('CF-Connecting-IP')||'').run();
            if(check_in){
                const push=notifyClinicStaff(env,{title:"Patient checked in",body:"A patient has arrived. Open Clinic Desk to prepare the visit and invoice.",tag:"patient-checkin-"+id,url:"/admin/index.html"});
                if(context.waitUntil)context.waitUntil(push);else await push;
            }
            return new Response(JSON.stringify({success:true,checked_in:check_in}),{headers:{"Content-Type":"application/json"}});
        }
        const validStatuses = ['pending', 'confirmed', 'done', 'cancelled', 'rejected', 'no_show'];
        if (!id || !validStatuses.includes(status)) {
            return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }

        const before = await env.DB.prepare("SELECT status, patient_id, date, time FROM appointments WHERE id = ?").bind(id).first();
        if (!before) return new Response(JSON.stringify({ error: "Appointment not found" }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

        if (status === "pending" && before.status === "rejected") {
            const scheduled = new Date(before.date + "T" + String(before.time).slice(0,5) + ":00+05:00");
            if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
                return new Response(JSON.stringify({ error: "This appointment time has passed. Rejected appointments can only be moved back before their scheduled time." }), { status: 409, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
            }
        }
        const updated = await env.DB.prepare(
            "UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, id).run();
        // Appointment status is part of the patient's Drive record.
        const driveSync = syncPatientToDrive(env, before.patient_id);
        if (context.waitUntil) context.waitUntil(driveSync); else await driveSync;
        await env.DB.prepare(
            "INSERT INTO activity_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, 'appointment', ?, ?, ?)"
        ).bind(session.user_id, session.username, "appointment_status", id, before.status + " -> " + status, request.headers.get("CF-Connecting-IP") || "").run();
        if(before.status!==status){
            const messages={confirmed:["Appointment confirmed","An appointment has been confirmed in Clinic Desk."],cancelled:["Appointment cancelled","An appointment was cancelled."],rejected:["Appointment declined","An appointment request was declined."],no_show:["Patient marked no-show","An appointment was marked as no-show."],pending:["Appointment needs review","An appointment is waiting for review."],done:["Appointment completed","An appointment was marked complete."]};
            const [title,body]=messages[status]||["Appointment updated","An appointment status was updated."];
            const push=notifyClinicStaff(env,{title,body,tag:"appointment-status-"+id+"-"+status,url:"/admin/index.html"});
            if(context.waitUntil)context.waitUntil(push);else await push;
        }

        return new Response(JSON.stringify({ success: true, changes: updated.meta?.changes || 0 }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    } catch (err) {
        const message = String(err?.message || "");
        if (message.includes("UNIQUE constraint failed") || message.includes("uq_active_slot")) {
            return new Response(JSON.stringify({
                error: "This doctor is already booked at that date and time. Select another time before restoring the appointment.",
                code: "SLOT_TAKEN"
            }), { status: 409, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }
        return new Response(JSON.stringify({ error: "Unable to update the appointment. Please try again." }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
}
