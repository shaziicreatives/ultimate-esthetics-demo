export async function onRequestGet(context) {
    try {
        const { env, request } = context;
        const url = new URL(request.url);
        const doctor_id = url.searchParams.get('doctor_id') || 1;
        const date = url.searchParams.get('date');

        if (!date) {
            return new Response(JSON.stringify({ error: "Date is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const { results } = await env.DB.prepare(
            "SELECT time FROM appointments WHERE doctor_id = ? AND date = ? AND status IN ('pending', 'confirmed')"
        ).bind(doctor_id, date).all();

        const bookedSlots = results.map(row => row.time);

        return new Response(JSON.stringify({ bookedSlots }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
