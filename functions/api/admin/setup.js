export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return new Response(JSON.stringify({ error: "Database binding DB missing" }), { status: 503, headers: { "Content-Type": "application/json" } });
    if (!env.ADMIN_SETUP_KEY) return new Response(JSON.stringify({ error: "ADMIN_SETUP_KEY secret is not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
    const body = await request.json();
    const key = String(body.setup_key || "");
    const expected = String(env.ADMIN_SETUP_KEY);
    if (key.length !== expected.length || !key || ![...key].every((c, i) => c === expected[i])) return new Response(JSON.stringify({ error: "Invalid setup key" }), { status: 403, headers: { "Content-Type": "application/json" } });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    if ((count?.n || 0) !== 0) return new Response(JSON.stringify({ error: "Owner account already exists. Setup is closed." }), { status: 409, headers: { "Content-Type": "application/json" } });
    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      return new Response(JSON.stringify({ error: "Username 3-40 characters, valid email aur password kam az kam 12 characters hona chahiye." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const saltBytes = new Uint8Array(16); crypto.getRandomValues(saltBytes);
    const salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password + salt));
    const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("INSERT INTO users (username, email, password_hash, password_salt, role) VALUES (?, ?, ?, ?, 'owner')").bind(username, email, hash, salt).run();
    return new Response(JSON.stringify({ success: true, message: "Owner account created. You can now sign in." }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Owner setup failed. Check database schema." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
