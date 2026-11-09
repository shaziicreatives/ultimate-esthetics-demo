-- Track which connected Google account owns each Drive file reference.
-- This keeps links from an older account intact when the Owner reconnects another account.
ALTER TABLE google_drive_files ADD COLUMN google_email TEXT;
UPDATE google_drive_files
SET google_email = (SELECT google_email FROM google_drive_connections WHERE id=1)
WHERE google_email IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_files_google_email_updated
ON google_drive_files(google_email, updated_at);
