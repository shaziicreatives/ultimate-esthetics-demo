export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, name, title, bio, photo_key, is_active FROM doctors WHERE is_active = 1 ORDER BY sort_order, id"
    ).all();
    return new Response(JSON.stringify({ doctors: results }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not load doctors" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
