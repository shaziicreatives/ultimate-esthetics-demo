export async function onRequestPost(context) {
    try {
        const { env, request } = context;
        const { username, password } = await request.json();

        if (!username || !password) {
            return new Response(JSON.stringify({ error: "Username and password are required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const user = await env.DB.prepare(
            "SELECT * FROM users WHERE username = ? AND is_active = 1"
        ).bind(username).first();

        if (!user) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        const encoder = new TextEncoder();
        const data = encoder.encode(password + user.password_salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (computedHash !== user.password_hash) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), {
                status: 401,
                headers: { "Content-Type": "application/json" }
            });
        }

        const tokenBytes = new Uint8Array(32);
        crypto.getRandomValues(tokenBytes);
        const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const tokenBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const tokenHash = Array.from(new Uint8Array(tokenBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await env.DB.prepare(
            "INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)"
        ).bind(user.id, tokenHash, expiresAt, request.headers.get('CF-Connecting-IP') || '', request.headers.get('User-Agent') || '').run();

        await env.DB.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();

        const cookie = `admin_token=${token}; HttpOnly; Secure; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`;

        return new Response(JSON.stringify({ success: true, role: user.role }), {
            headers: {
                "Content-Type": "application/json",
                "Set-Cookie": cookie
            }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: "An unexpected error occurred." }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
