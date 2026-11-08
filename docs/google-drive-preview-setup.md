# Google Drive integration setup (Preview)

This integration is Owner-only. It is not active until the following setup is completed.

## Google Cloud Console

1. Create or choose a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen and add the Owner's Google account as a test user while the app is in Testing.
4. Create an OAuth 2.0 Web application client.
5. Add the exact Preview callback URI:
   `https://<PREVIEW-DEPLOYMENT-HOST>/api/admin/drive/oauth/callback`
6. Add the production callback URI only when a Production release is explicitly approved:
   `https://ultimate-esthetics-demo.pages.dev/api/admin/drive/oauth/callback`

The current OAuth implementation requests `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`. This scope limits the app to files/folders it creates or files explicitly opened with the app. It does not grant broad access to arbitrary existing Drive folders. Existing-folder selection therefore requires a Google Picker flow and Picker API configuration before that feature can be enabled.

## Cloudflare Pages secrets

Add these secrets to the Preview environment only:

- `GOOGLE_CLIENT_ID`: OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: OAuth web client secret.
- `GOOGLE_DRIVE_TOKEN_KEY`: a long, random secret used as the server-side encryption key for OAuth tokens. Use a unique value and store it safely.

Never put these values in source code, frontend settings, or chat.

## Database migration

The additive migration is `db/migrations/0009_google_drive.sql`.

**Important:** Preview and Production currently bind to the same D1 database. Do not apply this migration through the Preview environment until a backup is made and the Owner explicitly approves the shared-database schema change. Do not run sample patient/payment inserts.

## Current implementation limits

- Owner-only connection/status/settings API and OAuth start/callback are implemented.
- Token encryption uses AES-GCM with a key derived from `GOOGLE_DRIVE_TOKEN_KEY`.
- The initial UI can create a dedicated clinic root folder in My Drive.
- Existing arbitrary folder browsing/selection is not implemented; the Drive Picker integration is still required.
- Patient/visit folder creation, invoice PDF generation, file upload/update, retry queue processing, and automatic sync hooks are not yet implemented.
- Do not rely on Google Drive as a patient-record backup until those items are implemented and end-to-end tested.
