-- Track connected account ownership and clinic backup history for Google Drive.
ALTER TABLE google_drive_files ADD COLUMN google_email TEXT;
UPDATE google_drive_files
SET google_email = (SELECT google_email FROM google_drive_connections WHERE id=1)
WHERE google_email IS NULL;
CREATE INDEX IF NOT EXISTS idx_drive_files_google_email_updated
ON google_drive_files(google_email, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drive_patient_sync_job
ON google_drive_sync_jobs(patient_id) WHERE job_kind='patient';

ALTER TABLE google_drive_connections
ADD COLUMN auto_backup_daily INTEGER NOT NULL DEFAULT 1;
ALTER TABLE google_drive_connections
ADD COLUMN auto_save_visit_pdf INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS google_drive_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_email TEXT NOT NULL,
  backup_kind TEXT NOT NULL CHECK(backup_kind IN ('daily','manual')),
  backup_date TEXT NOT NULL,
  file_name TEXT NOT NULL,
  drive_file_id TEXT UNIQUE,
  web_view_link TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','saved','failed')),
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_backups_account_date
ON google_drive_backups(google_email, backup_kind, backup_date, created_at);
