# Creative Clan AI connector (read-only pilot)

This branch contains the first server-side connector endpoint for Ultimate Esthetics.

## Scope

- Endpoint: `POST /api/agent/summary`
- Authentication: server-to-server `Authorization: Bearer <AI_AGENT_CONNECTOR_TOKEN>`
- Supported action: `today_summary`
- Returns only aggregate appointment counts for the current Asia/Karachi date.
- Does not return patient names, phone numbers, appointment-level records, clinical notes, invoices, or other patient-identifying information.
- Does not write to D1 or change clinic data.

The endpoint is intentionally unavailable until a unique token of at least 32 characters is configured.

## Configure after the Cloudflare Pages project is linked

Generate one unique token locally. Do not paste it into chat or commit it:

```bash
openssl rand -hex 32
```

Add the exact same value as a secret to the Ultimate Esthetics Pages project:

```bash
npx wrangler pages secret put AI_AGENT_CONNECTOR_TOKEN --project-name ultimate-esthetics-demo
```

Optional non-secret clinic label:

```bash
npx wrangler pages secret put AI_AGENT_CLINIC_NAME --project-name ultimate-esthetics-demo
```

Use the token only in the server-side AI Business Agent Worker secret named `ULTIMATE_ESTHETICS_CONNECTOR_TOKEN`. Configure the Worker URL and approved business ID there as server-side variables/secrets. Never add the token to `public/`, frontend JavaScript, browser storage, or a committed `.env` file.

## Smoke test

After deployment, call the endpoint from a trusted server or terminal. Replace the URL and token locally; do not publish either value:

```bash
curl -X POST "https://YOUR-CLINIC-DOMAIN/api/agent/summary" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"today_summary"}'
```

Expected response contains `ok: true`, a clinic date, total appointments, checked-in count, and counts grouped by status. An unauthenticated request must return 401.

## Deployment safety

Deploy only the `feature/ai-integration` branch to a separate Cloudflare Pages preview/staging environment first. Do not change the production branch or production database configuration until the owner verifies the preview. The endpoint is read-only and does not require a D1 migration.
