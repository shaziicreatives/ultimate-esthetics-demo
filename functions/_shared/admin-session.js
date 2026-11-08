// Shared admin-session validation for all authenticated Pages Functions.
const COOKIE_NAME = "admin_token";

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

  // expires_at is written as an ISO-8601 timestamp. Convert both sides to
  // SQLite datetimes rather than relying on lexical comparison of mixed formats.
  return env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, u.username, u.email,
            u.role, u.doctor_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > datetime('now')
        AND u.is_active = 1`
  ).bind(tokenHash).first();
}
