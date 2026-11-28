# Clinic Preview database reconciliation

## Isolated Preview target
- Pages project: `ultimate-esthetics-demo`
- Preview branch: `feature/ai-integration`
- Preview deployment: `https://aa8ed564.ultimate-esthetics-demo.pages.dev`
- Preview D1 database: `ultimate-esthetics-preview-isolated`
- D1 database ID: `c1434008-abf9-4d9d-8ee7-430e7320e795`
- The Preview deployment's `DB` binding points to this isolated database.
- Production branch remains `main`; Production D1 is not bound to the Preview environment.

## Schema reconciliation
`db/schema.sql` documents the original clinic schema but does not represent every later table/column/index currently present in the deployed Preview database. To avoid destructive guesses, the live isolated Preview D1 catalog was exported as a schema-only snapshot to `db/preview-schema-snapshot.sql`.
- 32 application tables
- 34 explicit indexes
- No row data, patient details, credentials, or tokens included
- Cloudflare-managed `_cf_KV` excluded
- Empty legacy `_preview_seed_status` helper table retained; its seed route has been removed

Future clinic D1 schema changes must be committed as ordered migration files and tested against Preview before deployment. Do not treat `db/schema.sql` alone as a complete replay of the current database.

## Preview data and login verification
At verification time, Preview contained one active Owner login account and zero rows in patients, appointments, visits, payments, and patient notes. The activity log recorded a successful Owner login on 2026-11-28 10:39:22 UTC. No production clinic records were copied into Preview.

## Safety boundary
This snapshot is schema-only. Never import Production patient records, user credentials, integration secrets, or session tokens into Preview. Keep Production D1 and `main` untouched during Preview development.
