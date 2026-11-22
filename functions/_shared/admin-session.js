// Shared admin-session validation for all authenticated Pages Functions.
const COOKIE_NAME = "admin_token";

// Short-lived per-isolate cache so a burst of dashboard requests does not
// query D1 for the same session on every API call.
const SESSION_CACHE_TTL_MS = 20000;
const SESSION_CACHE_MAX = 500;
const sessionCache = new Map();

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}

export function forgetAdminSession(tokenHash) {
  if (tokenHash) sessionCache.delete(tokenHash);
}

export async function getAdminSession(request, env) {
  if (!env || !env.DB) throw new Error("Database binding DB is unavailable");
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  const tokenHash = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  const cached = sessionCache.get(tokenHash);
  if (cached) {
    if (cached.expires > Date.now()) return { ...cached.user };
    sessionCache.delete(tokenHash);
  }

  // Normalize the legacy Admin account, which older schemas stored as role='owner'.
  const user = await env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, u.username, u.email,
            u.role, u.doctor_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > datetime('now')
        AND u.is_active = 1`
  ).bind(tokenHash).first();
  if (user && user.role === 'owner' && String(user.username).toLowerCase() === 'admin') {
    user.role = 'admin';
  }
  if (user) {
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      sessionCache.delete(sessionCache.keys().next().value);
    }
    sessionCache.set(tokenHash, { user: { ...user }, expires: Date.now() + SESSION_CACHE_TTL_MS });
  }
  return user;
}
