import { makeSession, sessionCookie, json } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  const username = env.ADMIN_USERNAME || "";
  const password = env.ADMIN_PASSWORD || "";
  if (!username || !password || !(env.ADMIN_SESSION_SECRET || env.SESSION_SECRET)) {
    return json({ success: false, error: "Admin credentials are not configured in Cloudflare Pages environment variables." }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ success: false, error: "Invalid JSON body." }, 400); }
  const suppliedUser = String(body.username || "");
  const suppliedPass = String(body.password || "");
  const equal = (a, b) => {
    let diff = a.length ^ b.length;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
    return diff === 0;
  };
  if (!equal(suppliedUser, username) || !equal(suppliedPass, password)) {
    return json({ success: false, error: "Invalid username or password." }, 401);
  }
  try {
    const token = await makeSession(env);
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie(request, token) });
  } catch (error) {
    return json({ success: false, error: "Could not create admin session." }, 500);
  }
}
