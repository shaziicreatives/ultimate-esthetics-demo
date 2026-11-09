# Google Drive integration setup (Preview)

Google Drive settings are Owner-only. The integration is designed to store clinic records in the Owner-selected Google Drive folder. Preview and Production remain isolated; the integration credentials are Preview-only until the Production release is explicitly approved.

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select the project that will own the clinic Drive integration.
3. Enable **Google Drive API** and **Google Picker API**.
4. Configure the OAuth consent screen. While the app is in Testing, add the Owner's Google account as a test user.
5. Create an OAuth 2.0 Client ID of type **Web application**.
6. Add this exact Authorized redirect URI:

   `https://feature-clinic-patients-invo.ultimate-esthetics-demo.pages.dev/api/admin/drive/oauth/callback`

   This is the current stable Preview branch alias. If the Preview branch alias changes, update the URI to match the current stable alias.

7. Create an API key for Google Picker. Restrict it to the Preview website referrer:
   
   `https://feature-clinic-patients-invo.ultimate-esthetics-demo.pages.dev/*`

   Restrict the key to the Google Picker API (and any Google API explicitly required in the Google Cloud console).
8. Find the Google Cloud **Project number**; use it as `GOOGLE_APP_ID` (not the project name or project ID).

The app requests `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`. This is deliberately narrower than full Drive access: the app can create/manage its own clinic files and files/folders the Owner explicitly selects through Google Picker. It does not read all unrelated personal Drive files.

**Important token-lifetime note:** Google states that an external OAuth app left in **Testing** issues refresh tokens that expire after 7 days when Drive scopes are requested. For uninterrupted sync and daily backups, move the OAuth app to **In production** and complete any Google verification that Google requires for the requested scopes. Otherwise the Owner may need to reconnect the account weekly.

## 2. Cloudflare Pages Preview secrets

Open Cloudflare Dashboard → Workers & Pages → `ultimate-esthetics-demo` → Settings → Variables and Secrets → **Preview**.

Add these four Preview-only values:

- `GOOGLE_CLIENT_ID`: OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: OAuth web client secret.
- `GOOGLE_API_KEY`: restricted Google Picker API key.
- `GOOGLE_APP_ID`: numeric Google Cloud project number.

`GOOGLE_DRIVE_TOKEN_KEY` has already been generated and stored as an encrypted Preview secret. Do not put any of these values in GitHub, source code, frontend settings, or public issue comments. Do not configure these secrets in Production until the Owner explicitly approves a Production release.

After saving the secrets, trigger a new Preview deployment so the Pages Functions receive them.

## 3. What the integration does

- Owner-only Google OAuth connection and account verification.
- Encrypted refresh-token storage in the isolated Preview D1 database.
- Google Picker folder selection, including Shared Drives when enabled for the Google project.
- A clinic root folder with a `Patients` subfolder, one folder per patient, and one folder per visit.
- Patient profile JSON with patient details, referral information, notes, appointments, and invoice/visit summaries.
- Visit JSON, invoice PDF, and visit-summary PDF. Existing Drive files are updated instead of duplicated on each edit.
- Automatic sync after website bookings, appointment status updates, patient edits, manual entries, and visit/invoice creation or edits.
- A retry queue with retry controls in the Owner panel.
- Existing-record backfill from the Owner panel.
- Manual clinic-data backup and optional daily JSON backups to a separate `Clinic Backups` folder.

Clinic backups include staff usernames/roles, doctor information, patients, appointments, visits, treatments, payments, patient notes, token counters, invoice numbering, and user permissions. Password hashes/salts, login sessions, OAuth tokens, API secrets, login-attempt history, and push subscription endpoints are intentionally excluded.

Daily backup checks run while the Owner admin panel is open. This is not an always-on scheduled task when nobody is using the app.

## 4. First Preview sign-in and data copy

The isolated Preview database is initially empty. On the first Preview login, enter the existing clinic **Owner** username and password. The Preview-only setup route verifies the password hash against the original database, without writing to or changing the original account. It then copies the existing clinic records into the isolated Preview database before the normal login request runs. The password is not stored by the seeding route. Sign in as Admin or Reception only after the Owner has completed the first Preview sign-in once.

## 5. Preview and Production separation

- Preview D1: `ultimate-esthetics-preview-isolated`.
- Production D1: `ultimate-esthetics-db-preview`.
- The Preview connection and Google secrets must remain in Preview only.
- Do not copy the Preview OAuth connection or Preview-only secrets into Production until the Owner approves the Production release and its callback URI is configured separately.

Google Drive is an additional document/backup destination, not a substitute for the clinic database. Keep normal database backups as well.
