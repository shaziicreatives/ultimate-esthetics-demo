-- Google Drive integration. Safe additive migration; do not apply to the shared D1
-- until the Owner has reviewed the Preview implementation and a backup is available.
CREATE TABLE IF NOT EXISTS google_drive_connections (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  encrypted_tokens TEXT NOT NULL,
  token_expires_at INTEGER,
  selected_drive_id TEXT,
  selected_drive_name TEXT,
  root_folder_id TEXT,
  root_folder_name TEXT,
  auto_save_invoice_pdf INTEGER NOT NULL DEFAULT 1,
  auto_save_patient_record INTEGER NOT NULL DEFAULT 1,
  auto_save_visit_record INTEGER NOT NULL DEFAULT 1,
  connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at DATETIME,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_oauth_expiry ON google_drive_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS google_drive_patient_folders (
  patient_id INTEGER PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_visit_folders (
  visit_id INTEGER PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS google_drive_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL CHECK(file_kind IN ('invoice_pdf','patient_record_json','visit_record_json','visit_details_pdf')),
  drive_file_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  web_view_link TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_files_patient ON google_drive_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_drive_files_visit ON google_drive_files(visit_id);
CREATE TABLE IF NOT EXISTS google_drive_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  job_kind TEXT NOT NULL CHECK(job_kind IN ('patient','visit')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','saved','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_kind, visit_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_drive_sync_pending ON google_drive_sync_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS google_drive_folder_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_email TEXT NOT NULL,
  folder_kind TEXT NOT NULL CHECK(folder_kind IN ('patient','visit')),
  patient_id INTEGER NOT NULL,
  visit_id INTEGER,
  folder_id TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drive_folder_history_patient ON google_drive_folder_history(patient_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_drive_folder_history_visit ON google_drive_folder_history(visit_id, archived_at);
