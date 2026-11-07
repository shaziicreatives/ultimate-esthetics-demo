async function verifySession(request, env) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/admin_token=([^;]+)/);
    if (!match) return null;
    const token = match[1];

    const tokenBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(tokenBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const session = await env.DB.prepare(
        `SELECT s.*, u.role, u.doctor_id, u.username FROM sessions s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.token_hash = ? AND s.expires_at > DATETIME('now') AND u.is_active = 1`
    ).bind(tokenHash).first();

    return session;
}

export async function onRequestGet(context) {
    try {
        const { env, request } = context;
        const session = await verifySession(request, env);
        if (!session) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        let query = `
            SELECT a.*, p.name as patient_name, p.phone as patient_phone, d.name as doctor_name 
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors d ON a.doctor_id = d.id
        `;

        let bindings = [];
        if (session.role === 'doctor') {
            query += " WHERE a.doctor_id = ?";
            bindings.push(session.doctor_id);
        }

        query += " ORDER BY a.date DESC, a.time DESC LIMIT 100";

        const { results } = await env.DB.prepare(query).bind(...bindings).all();

        return new Response(JSON.stringify({ appointments: results }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}

export async function onRequestPatch(context) {
    try {
        const { env, request } = context;
        const session = await verifySession(request, env);
        if (!session || session.role === 'doctor') {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        const { id, status } = await request.json();
        const validStatuses = ['pending', 'confirmed', 'done', 'cancelled', 'rejected', 'no_show'];
        if (!id || !validStatuses.includes(status)) {
            return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        await env.DB.prepare(
            "UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(status, id).run();

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
