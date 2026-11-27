# Creative Clan AI Agent — Secure Clinic Bridge Plan

Status: DESIGN RECORDED — NOT ACTIVE. Preview only.

## Scope
Connect the Ultimate Esthetics Admin Portal to the central Creative Clan AI Worker without changing the clinic's existing login system. The clinic's existing HttpOnly `admin_token` session remains the source of identity. No browser-held connector secret, Supabase service-role key, or provider key is permitted.

## Repositories and branches
- Clinic: `shaziicreatives/ultimate-esthetics-demo`, branch `feature/ai-integration`
- Central AI: `shaziicreatives/ai-business-agent`, branch `feature/ultimate-esthetics-connector`
- Production `main`, production D1 and production Worker must remain untouched.

## Proposed request flow
1. Browser sends a same-origin request to a clinic Pages Function. The browser sends only the existing session cookie and the user's message.
2. The Pages Function calls `getAdminSession(request, env)`; reject missing/expired sessions. Only explicitly permitted clinic admin roles may use the assistant.
3. The Pages Function creates a short-lived, audience-bound signed assertion using a high-entropy Preview-only HMAC secret. Claims must include issuer, audience, expiry (maximum 60 seconds), issued-at, unique jti, business binding, clinic user ID and role. Never forward the raw clinic cookie or session token.
4. Central Worker verifies signature, issuer, audience, expiry, jti/replay protection, business ID and allowed role. It must not trust browser-supplied business IDs or roles.
5. Worker checks the exact business is active in `authorized_businesses`, the Super Admin has enabled the AI capability, required action permissions are active, and a non-blocked credit account with positive available allowance exists.
6. A server-side atomic reservation is made before model inference. Actual provider-reported usage is settled after success; failed requests release the reservation. Idempotency prevents duplicate charges.
7. The first clinic integration remains aggregate-only and read-only. Do not transmit patient names, phone numbers, patient IDs, clinical notes, invoices or individual medical records. No medical advice. No writes, appointment changes, check-ins, refunds or deletions.
8. Return a written answer in the user's language. Log request ID, actor, business, model, usage and outcome without storing sensitive prompt contents unnecessarily.

## Mandatory enablement gates
AI stays disabled unless ALL conditions are true:
- Owner authorization is recorded.
- Super Admin has approved the matching Access Request / `authorized_businesses` record.
- Exact approved business UUID and clinic domain are bound server-side.
- Super Admin explicitly enables the clinic Text Agent capability.
- Required read-only scope is granted.
- Preview credit account is configured and credits are allocated.
- Preview-only HMAC secrets and Worker URL are configured.
- Atomic reservation, settlement, release and idempotency migrations are deployed to the Preview Supabase project and tested.
- Security tests pass.

Owner authorization alone does not bypass Super Admin approval or credits.

## Required server configuration (Preview only)
Clinic Pages Functions:
- `AI_AGENT_BRIDGE_SECRET`: random high-entropy secret, at least 32 bytes.
- `AI_AGENT_WORKER_URL`: exact HTTPS Preview Worker URL.
- `AI_AGENT_BUSINESS_ID`: exact UUID only after Super Admin approval.

Central Preview Worker:
- Matching `AI_AGENT_BRIDGE_SECRET`.
- Supabase server-side credentials only if the chosen implementation requires them; never expose them to the browser.
- Exact approved business/domain configuration.

Do not copy production secrets into Preview. Never paste secret values into GitHub, chat, source code, or browser configuration.

## Required tests
- Missing/expired clinic session => 401.
- Non-admin or disabled clinic user => 403.
- Invalid signature, wrong issuer/audience, expired token, replayed jti => rejected.
- Wrong or unapproved business => rejected.
- Super Admin AI capability disabled => rejected.
- No credit account, zero credits, blocked account, or expired allowance => rejected before model call.
- Concurrent requests cannot overspend; duplicate idempotency key cannot double-charge.
- Model failure releases reservation.
- Successful response settles actual provider usage.
- Clinic connector returns aggregate-only fields and no patient-level data.
- Production endpoints and databases remain unchanged.

## Current blockers
- No matching Ultimate Esthetics row exists in Supabase `authorized_businesses` yet.
- Super Admin approval and explicit AI capability grant are still pending.
- Preview credit allocation is not confirmed.
- The existing credit consumption RPC is not a reserve/settle/release lifecycle.
- No bridge secret should be configured until the Preview-only implementation and security tests are ready.

## Deployment policy
Do not deploy or enable AI as part of this design record. Do not change `main`, production D1, production Worker, production Supabase settings, or production secrets. Deployment requires a separate explicit review and approval.
