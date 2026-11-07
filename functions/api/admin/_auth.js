const COOKIE = "ue_admin_session";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});
function secret(env) { return env.ADMIN_SESSION_SECRET || env.SESSION_SECRET || ""; }
function bytes(s) { return new TextEncoder().encode(s); }
async function sign(value, key) {
  const k = await crypto.subtle.importKey("raw", bytes(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, bytes(value)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export async function makeSession(env) {
  const key = secret(env);
  if (!key) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const exp = String(Math.floor(Date.now() / 1000) + 60 * 60 * 12);
  return exp + "." + await sign(exp, key);
}
export async function hasAdminSession(request, env) {
  const key = secret(env);
  if (!key) return false;
  const cookie = request.headers.get("Cookie") || "";
  const item = cookie.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  if (!item) return false;
  const token = decodeURIComponent(item.slice(COOKIE.length + 1));
  const [exp, signature, extra] = token.split(".");
  if (!exp || !signature || extra || !/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return signature === await sign(exp, key);
}
export function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === "https:";
  return COOKIE + "=" + encodeURIComponent(token) + "; Path=/api/admin; HttpOnly; SameSite=Lax; Max-Age=43200" + (secure ? "; Secure" : "");
}
export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:";
  return COOKIE + "=; Path=/api/admin; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : "");
}
export { json };
