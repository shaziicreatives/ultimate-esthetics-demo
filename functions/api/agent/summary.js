import { verifyClinicAssertion } from "../../_shared/ai-agent-assertion.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

function clinicDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

export async function onRequestPost({ request, env }) {
  const secret = String(env.AI_AGENT_BRIDGE_HMAC_SECRET || "");
  const configuredBusinessId = String(env.AI_AGENT_BUSINESS_ID || "");
  if (secret.length < 32 || !/^[0-9a-fA-F-]{36}$/.test(configuredBusinessId) || !env.DB) {
    return json({ ok: false, error: "Secure AI connector is not configured." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 4096) return json({ ok: false, error: "Unauthorized." }, 401);

  let claims;
  try {
    claims = await verifyClinicAssertion(token, secret);
  } catch {
    return json({ ok: false, error: "Invalid clinic assertion." }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== "ultimate-esthetics-clinic" ||
    claims.aud !== "creative-clan-ai-agent" ||
    claims.business_id !== configuredBusinessId ||
    claims.scope !== "clinic:summary:read" ||
    !["owner", "admin", "receptionist"].includes(String(claims.role || "").toLowerCase()) ||
    !claims.sub ||
    !/^[0-9a-fA-F-]{36}$/.test(String(claims.jti || "")) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.iat > now + 15 ||
    claims.exp <= now ||
    claims.exp - claims.iat > 60
  ) {
    return json({ ok: false, error: "Clinic assertion is expired or not authorized for this read-only scope." }, 403);
  }

  let body;
  try {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 1024) return json({ ok: false, error: "Request is too large." }, 413);
    body = JSON.parse(new TextDecoder().decode(raw) || "{}");
  } catch {
    return json({ ok: false, error: "Invalid JSON request." }, 400);
  }
  if (!body || body.action !== "today_summary") {
    return json({ ok: false, error: "Unsupported connector action." }, 400);
  }

  try {
    await env.DB.prepare("DELETE FROM ai_agent_bridge_assertions WHERE expires_at < ?")
      .bind(new Date().toISOString()).run();
    const consumed = await env.DB.prepare(
      "INSERT OR IGNORE INTO ai_agent_bridge_assertions (jti, expires_at) VALUES (?, ?)"
    ).bind(String(claims.jti), new Date(claims.exp * 1000).toISOString()).run();
    if (Number(consumed?.meta?.changes || 0) !== 1) {
      return json({ ok: false, error: "This clinic assertion has already been used." }, 409);
    }

    const date = clinicDate();
    const result = await env.DB.prepare(
      "SELECT status, COUNT(*) AS count, SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in FROM appointments WHERE date = ? GROUP BY status"
    ).bind(date).all();

    const byStatus = {};
    let total = 0;
    let checkedIn = 0;
    for (const row of result.results || []) {
      const count = Number(row.count || 0);
      byStatus[String(row.status || "unknown")] = count;
      total += count;
      checkedIn += Number(row.checked_in || 0);
    }

    return json({
      ok: true,
      data: {
        clinic: String(env.AI_AGENT_CLINIC_NAME || "Ultimate Esthetics").slice(0, 100),
        date,
        timezone: "Asia/Karachi",
        total_appointments: total,
        checked_in: checkedIn,
        by_status: byStatus,
        data_scope: "aggregate_only",
        patient_identifiers_included: false,
        clinical_information_included: false
      }
    });
  } catch {
    return json({ ok: false, error: "Clinic summary could not be loaded." }, 500);
  }
}
