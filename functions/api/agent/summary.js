// Private, read-only connector endpoint for Creative Clan AI Business Agent.
// Exposes aggregate clinic activity only. No patient names, contact details,
// clinical notes, invoices, or individual records are returned.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  }
});

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

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
  const configuredToken = String(env.AI_AGENT_CONNECTOR_TOKEN || "");
  if (configuredToken.length < 32) {
    return json({ ok: false, error: "AI connector is not configured." }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!suppliedToken || !constantTimeEqual(suppliedToken, configuredToken)) {
    return json({ ok: false, error: "Unauthorized." }, 401);
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
