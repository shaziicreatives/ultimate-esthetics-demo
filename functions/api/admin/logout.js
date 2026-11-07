import { clearSessionCookie, json } from "./_auth.js";
export async function onRequestPost({ request }) {
  return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
}
