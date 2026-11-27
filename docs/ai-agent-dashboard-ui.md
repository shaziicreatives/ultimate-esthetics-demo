# AI Agent Dashboard UI (Preview only)

## What changed
- Added a floating **AI Agent** launcher to `public/admin/index.html`.
- Added an animated circular orb and a responsive assistant panel for desktop and mobile.
- The panel clearly shows that the secure connection is still being configured.
- The message input remains disabled. No fake AI responses are generated and no patient data is read or changed by this UI.

## Why chat is not live yet
The Clinic Desk authenticates staff with its own HttpOnly `admin_token` cookie and Cloudflare D1 session. The central AI Worker currently verifies Supabase admin JWTs. These are different authentication systems. Do not put a Worker secret, connector token, Supabase service-role key, or clinic session token in browser JavaScript.

Before enabling chat, implement a server-side bridge:
1. Authenticate each request with `getAdminSession(request, env)`.
2. Enforce clinic role/permission policy on the server.
3. Use a short-lived, signed, audience-bound service credential between Pages Functions and the AI Worker; validate it server-side. Do not reuse a static secret in frontend code.
4. Add tenant/business authorization and clinic owner approval.
5. Enforce credit reservation before model inference and idempotent settlement/release afterward.
6. Keep this first clinic connector aggregate-only and read-only. Do not send patient identifiers or clinical notes to the model.
7. Add audit logging and verify the AI response before showing it as completed.

## Preview deployment
Deploy only branch `feature/ai-integration` to a separate Cloudflare Pages Preview project/environment with the isolated D1 binding configured in `wrangler.toml`. Keep `main` as the production branch and do not deploy this branch to production.

The AI Agent icon is a CSS orb placeholder. Replace it only after the owner supplies the final favicon/logo asset.
