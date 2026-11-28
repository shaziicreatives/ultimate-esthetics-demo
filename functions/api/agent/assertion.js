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
    if (!["owner", "admin", "receptionist"].includes(String(session.role || "").toLowerCase())) return json({ ok: false, error: "This clinic account is not authorized to use the AI Agent connector." }, 403);

    const businessId = String(env.AI_AGENT_BUSINESS_ID || "");
    const secret = String(env.AI_AGENT_BRIDGE_HMAC_SECRET || "");
    const businessIdPresent = businessId.length > 0;
    const businessIdValid = /^[0-9a-fA-F-]{36}$/.test(businessId);
    const hmacSecretPresent = secret.length > 0;
    const hmacSecretLengthValid = secret.length >= 32;

    if (!businessIdValid || !hmacSecretLengthValid) {
      // Safe diagnostics are returned only to Owner/Admin. Never expose the
      // secret, fragments, hashes, tokens, assertions, or session data.
      const role = String(session.role || "").toLowerCase();
      const diagnostics = ["owner", "admin"].includes(role) ? {
        diagnostics: {
          business_id_present: businessIdPresent,
          business_id_valid: businessIdValid,
          hmac_secret_present: hmacSecretPresent,
          hmac_secret_length_valid: hmacSecretLengthValid,
          failed_checks: [
            ...(!businessIdPresent ? ["business_id_missing"] : []),
            ...(businessIdPresent && !businessIdValid ? ["business_id_invalid"] : []),
            ...(!hmacSecretPresent ? ["hmac_secret_missing"] : []),
            ...(hmacSecretPresent && !hmacSecretLengthValid ? ["hmac_secret_too_short"] : [])
          ]
        }
      } : {};
      return json({ ok: false, error: "Preview bridge configuration is incomplete.", ...diagnostics }, 503);
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
