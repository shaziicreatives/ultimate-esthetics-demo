export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const cookieHeader = request.headers.get("Cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "admin_token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax",
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Logout failed" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
