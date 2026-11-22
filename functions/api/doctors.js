// Public doctor list. Cache the anonymous response briefly at the edge; staff always see fresh data.
const CACHE_SECONDS = 30;

export async function onRequestGet({ request, env }) {
  try {
    const isStaff = (request.headers.get("Cookie") || "").includes("admin_token=");
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(new URL(request.url).origin + "/api/doctors", { method: "GET" });
    if (!isStaff && cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const { results } = await env.DB.prepare(
      "SELECT id, name, title, bio, photo_key, is_active FROM doctors WHERE is_active = 1 ORDER BY sort_order, id"
    ).all();

    if (isStaff) {
      return new Response(JSON.stringify({ doctors: results }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    const response = new Response(JSON.stringify({ doctors: results }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=15, s-maxage=" + CACHE_SECONDS
      }
    });
    if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load doctors" }), {
      status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
}
