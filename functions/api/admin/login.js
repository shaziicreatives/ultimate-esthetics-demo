export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    if (!env.DB) return new Response(JSON.stringify({ error: "Database binding DB missing" }), { status: 503, headers: { "Content-Type": "application/json" } });
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) return new Response(JSON.stringify({ error: "Username and password are required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_attempts WHERE (username = ? OR ip = ?) AND success = 0 AND created_at >= datetime('now', '-15 minutes')"
    ).bind(username, ip).first();
    if ((recent?.n || 0) >= 10) return new Response(JSON.stringify({ error: "Too many login attempts. Please try again in 15 minutes." }), { status: 429, headers: { "Content-Type": "application/json" } });

    const user = await env.DB.prepare("SELECT * FROM users WHERE (username = ? COLLATE NOCASE OR (role = 'owner' AND username = 'admin' AND ? = 'Owner')) AND is_active = 1").bind(username,username).first();
    if (user?.role === "owner" && username.toLowerCase() === "owner" && user.username.toLowerCase() === "admin") user.username = "Owner";
    // Legacy Admin rows used role='owner' because the original schema had no admin role.
    // Keep the stored schema compatible but never grant Admin Owner-only permissions.
    if (user?.role === "owner" && user.username.toLowerCase() === "admin") user.role = "admin";
    if (user?.locked_until && new Date(user.locked_until.replace(" ", "T") + (user.locked_until.includes("Z") ? "" : "Z")).getTime() > Date.now()) {
      return new Response(JSON.stringify({ error: "Account temporarily locked. Please try again later." }), { status: 423, headers: { "Content-Type": "application/json" } });
    }

    let valid = false;
    let usedSharedCredential = false;
    if (user) {
      const bytes = new TextEncoder().encode(password + user.password_salt);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
      valid = hash === user.password_hash;
      // Emergency clinic-wide credential is configured as a Cloudflare secret, never in source.
      const shared = typeof env.GENERAL_LOGIN_PASSWORD === "string" ? env.GENERAL_LOGIN_PASSWORD : "";
      if (!valid && shared.length >= 8 && password === shared) {
        valid = true;
        usedSharedCredential = true;
      }
    }
    await env.DB.prepare("INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)").bind(username, ip, valid ? 1 : 0).run();

    if (!valid) {
      if (user) {
        await env.DB.prepare("UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN datetime('now', '+15 minutes') ELSE locked_until END WHERE id = ?").bind(user.id).run();
        const lockState = await env.DB.prepare("SELECT failed_attempts, locked_until FROM users WHERE id = ?").bind(user.id).first();
        if ((lockState?.failed_attempts || 0) >= 5 && lockState?.locked_until) {
          return new Response(JSON.stringify({ error: "5 unsuccessful attempts reached. Please contact the developer for assistance.", locked: true, retry_after_minutes: 15 }), { status: 423, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        }
      }
      return new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    if (user.role === "owner" && username.toLowerCase() !== "owner" && user.username.toLowerCase() === "admin") user.role = "admin";
    if (user.role === "owner") {
      await env.DB.prepare("UPDATE users SET username='Owner', updated_at=CURRENT_TIMESTAMP WHERE id=? AND role='owner' AND username='admin' COLLATE NOCASE").bind(user.id).run();
      user.username = "Owner";
    }
    const tokenBytes = new Uint8Array(32); crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const tokenDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(tokenDigest)).map(b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)").bind(user.id, tokenHash, expiresAt, ip, request.headers.get("User-Agent") || "").run();
    await env.DB.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
    await env.DB.prepare("INSERT INTO activity_log (user_id, username, action, entity, details, ip) VALUES (?, ?, 'login', 'session', ?, ?)").bind(user.id, user.username, usedSharedCredential ? "Login successful via shared clinic credential" : "Admin login successful", ip).run();

    const cookie = "admin_token=" + token + "; HttpOnly; Secure; Path=/; Max-Age=43200; SameSite=Lax";
    return new Response(JSON.stringify({ success: true, role: user.role }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Login failed. Please check the server configuration." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
