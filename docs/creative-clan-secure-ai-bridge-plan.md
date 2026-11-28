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
2. The Pages Function calls `getAdminSession(request, env)`; reject missing/expired sessions. For the initial aggregate-only summary, allow only existing `owner`, `admin`, and `receptionist` session roles. Preserve the actual role in the assertion; never elevate roles. Any future action must be checked against that user's existing clinic-side permission before execution.
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
- `AI_AGENT_BRIDGE_HMAC_SECRET`: random high-entropy secret, at least 32 bytes.
- `AI_AGENT_BUSINESS_ID`: `c55320e8-972d-48fd-be83-649c5d865df5` (approved Ultimate Esthetics business UUID).
- `AI_AGENT_WORKER_URL`: exact HTTPS Preview Worker URL if the frontend configuration uses it.

Central Preview Worker:
- `CLINIC_BRIDGE_HMAC_SECRET`: the same secret value as clinic `AI_AGENT_BRIDGE_HMAC_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY`: server-side secret required by the Worker; never expose it to the browser.
- Existing `SUPABASE_URL` binding.
- Exact approved business/domain configuration.

Do not copy production secrets into Preview. Never paste secret values into GitHub, chat, source code, or browser configuration.

## Required tests
- Missing/expired clinic session => 401.
- Unsupported role or disabled clinic user => 403; `owner`, `admin`, and `receptionist` may obtain only the initial read-only summary assertion.
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
- Ultimate Esthetics exists as an active approved business (`c55320e8-972d-48fd-be83-649c5d865df5`); Access Request is approved.
- No AI credits have been allocated and no platform connection record exists.
- Clinic Preview is missing `AI_AGENT_BUSINESS_ID` and `AI_AGENT_BRIDGE_HMAC_SECRET`.
- Central Preview Worker is missing `CLINIC_BRIDGE_HMAC_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.
- The existing credit consumption RPC is not a reserve/settle/release lifecycle.
- No bridge secret should be configured until the Preview-only implementation and security tests are ready.

## Deployment policy
Do not deploy or enable AI as part of this design record. Do not change `main`, production D1, production Worker, production Supabase settings, or production secrets. Deployment requires a separate explicit review and approval.
