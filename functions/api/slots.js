// Booked-slot lookups are short-lived edge cached for identical doctor/date requests.
const CACHE_SECONDS = 5;

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

        const cache = typeof caches !== "undefined" ? caches.default : null;
        const cacheKey = new Request(url.origin + "/api/slots?doctor_id=" + encodeURIComponent(doctor_id) + "&date=" + encodeURIComponent(date), { method: "GET" });
        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) return hit;
        }

        const { results } = await env.DB.prepare(
            "SELECT time FROM appointments WHERE doctor_id = ? AND date = ? AND status NOT IN ('cancelled', 'rejected', 'no_show')"
        ).bind(doctor_id, date).all();

        // Convert '14:00:00' or '14:00' to numeric hour (14) to perfectly match frontend chips
        const bookedSlots = results.map(row => {
            const parts = row.time.split(':');
            return parseInt(parts[0], 10);
        });

        const response = new Response(JSON.stringify({ bookedSlots }), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=3, s-maxage=" + CACHE_SECONDS
            }
        });
        if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
    }
}
