import { getAdminSession } from "../../_shared/admin-session.js";
import { signClinicAssertion } from "../../_shared/ai-agent-assertion.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

export async function onRequestPost({ request, env }) {
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 1024) return json({ ok: false, error: "Request is too large." }, 413);
    const session = await getAdminSession(request, env);
    if (!session) return json({ ok: false, error: "Clinic admin login required." }, 401);
    if (session.role !== "admin") return json({ ok: false, error: "Only an authorized clinic administrator can connect the AI Agent." }, 403);

    const businessId = String(env.AI_AGENT_BUSINESS_ID || "");
    const secret = String(env.AI_AGENT_BRIDGE_HMAC_SECRET || "");
    if (!/^[0-9a-fA-F-]{36}$/.test(businessId) || secret.length < 32) {
      return json({ ok: false, error: "Preview bridge configuration is incomplete." }, 503);
    }

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "ultimate-esthetics-clinic",
      aud: "creative-clan-ai-agent",
      sub: String(session.user_id),
      role: session.role,
      business_id: businessId,
      scope: "clinic:summary:read",
      origin: new URL(request.url).origin,
      iat: now,
      exp: now + 60,
      jti: crypto.randomUUID()
    };
    const assertion = await signClinicAssertion(claims, secret);
    return json({ ok: true, assertion, expires_in: 60, scope: claims.scope });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not issue a secure clinic assertion." }, 500);
  }
}
