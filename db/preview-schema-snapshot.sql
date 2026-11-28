-- Clinic Preview D1 schema-only snapshot.
-- Source: isolated Preview D1 database c1434008-abf9-4d9d-8ee7-430e7320e795.
-- Captured 2026-11-28. No table rows or patient/business data are included.
-- _cf_KV is Cloudflare-managed and intentionally excluded.
-- _preview_seed_status is retained as an empty legacy helper table; the seed route was removed.
PRAGMA foreign_keys=OFF;

-- Tables
CREATE TABLE _preview_seed_status (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, copied_tables INTEGER NOT NULL DEFAULT 0, copied_rows INTEGER NOT NULL DEFAULT 0, counts_json TEXT, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE activity_log (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,     username TEXT,     action TEXT NOT NULL,     entity TEXT,     entity_id INTEGER,     details TEXT,     ip TEXT,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE ai_agent_bridge_assertions (jti TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE TABLE appointment_daily_tokens (appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,clinic_date TEXT NOT NULL,token INTEGER NOT NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE(clinic_date,token));
CREATE TABLE appointments (     id INTEGER PRIMARY KEY AUTOINCREMENT,     doctor_id INTEGER NOT NULL REFERENCES doctors(id),     patient_id INTEGER NOT NULL REFERENCES patients(id),     date TEXT NOT NULL,     time TEXT NOT NULL,     treatment TEXT,     status TEXT NOT NULL DEFAULT 'pending'         CHECK (status IN ('pending', 'confirmed', 'done', 'cancelled', 'rejected', 'no_show')),     source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'manual')),     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,     follow_up_date TEXT,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP , checked_in_at DATETIME);
CREATE TABLE clinic_integrations (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by INTEGER REFERENCES users(id),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE clinic_security_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by INTEGER REFERENCES users(id), updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE daily_token_counters (clinic_date TEXT PRIMARY KEY,last_number INTEGER NOT NULL DEFAULT 0);
CREATE TABLE doctors (     id INTEGER PRIMARY KEY AUTOINCREMENT,     name TEXT NOT NULL,     title TEXT NOT NULL,     bio TEXT,     photo_key TEXT,     is_active INTEGER NOT NULL DEFAULT 1,     sort_order INTEGER NOT NULL DEFAULT 0,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE email_changes (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,     new_email TEXT NOT NULL COLLATE NOCASE,     token_hash TEXT NOT NULL UNIQUE,     expires_at DATETIME NOT NULL,     used_at DATETIME,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP , current_verified_at DATETIME, new_token_hash TEXT, new_expires_at DATETIME);
CREATE TABLE email_verification_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at DATETIME NOT NULL, used_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE google_drive_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, google_email TEXT NOT NULL, backup_kind TEXT NOT NULL CHECK(backup_kind IN ('daily','manual')), backup_date TEXT NOT NULL, file_name TEXT NOT NULL, drive_file_id TEXT UNIQUE, web_view_link TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','saved','failed')), last_error TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE google_drive_connections (id INTEGER PRIMARY KEY CHECK (id = 1), owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, google_email TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, token_expires_at INTEGER, selected_drive_id TEXT, selected_drive_name TEXT, root_folder_id TEXT, root_folder_name TEXT, auto_save_invoice_pdf INTEGER NOT NULL DEFAULT 1, auto_save_patient_record INTEGER NOT NULL DEFAULT 1, auto_save_visit_record INTEGER NOT NULL DEFAULT 1, connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_sync_at DATETIME, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, auto_backup_daily INTEGER NOT NULL DEFAULT 1, auto_save_visit_pdf INTEGER NOT NULL DEFAULT 1);
CREATE TABLE google_drive_files (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE, visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE, file_kind TEXT NOT NULL CHECK(file_kind IN ('invoice_pdf','patient_record_json','visit_record_json','visit_details_pdf')), drive_file_id TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, web_view_link TEXT, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, google_email TEXT);
CREATE TABLE google_drive_folder_history (id INTEGER PRIMARY KEY AUTOINCREMENT, google_email TEXT NOT NULL, folder_kind TEXT NOT NULL CHECK(folder_kind IN ('patient','visit')), patient_id INTEGER NOT NULL, visit_id INTEGER, folder_id TEXT NOT NULL, folder_name TEXT NOT NULL, archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE google_drive_oauth_states (state_hash TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE google_drive_patient_folders (patient_id INTEGER PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, folder_name TEXT NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE google_drive_sync_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE, visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE, job_kind TEXT NOT NULL CHECK(job_kind IN ('patient','visit')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','saved','failed')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(job_kind, visit_id, patient_id));
CREATE TABLE google_drive_visit_folders (visit_id INTEGER PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE, patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE, folder_id TEXT NOT NULL, folder_name TEXT NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE invoice_sequence (id INTEGER PRIMARY KEY CHECK(id=1),last_number INTEGER NOT NULL);
CREATE TABLE login_attempts (     id INTEGER PRIMARY KEY AUTOINCREMENT,     username TEXT COLLATE NOCASE,     ip TEXT,     success INTEGER NOT NULL DEFAULT 0,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE password_resets (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,     token_hash TEXT NOT NULL UNIQUE,     expires_at DATETIME NOT NULL,     used_at DATETIME,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE patient_notes (     id INTEGER PRIMARY KEY AUTOINCREMENT,     patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,     note TEXT NOT NULL,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE patients (     id INTEGER PRIMARY KEY AUTOINCREMENT,     name TEXT NOT NULL,     phone TEXT NOT NULL UNIQUE,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP , referred_by_patient_id INTEGER REFERENCES patients(id), referral_notes TEXT);
CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE, patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE, amount INTEGER NOT NULL CHECK(amount > 0), method TEXT NOT NULL DEFAULT 'cash', reference TEXT, received_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,user_agent TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,     token_hash TEXT NOT NULL UNIQUE,     expires_at DATETIME NOT NULL,     ip TEXT,     user_agent TEXT,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE settings (     key TEXT PRIMARY KEY,     value TEXT NOT NULL,     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE user_permissions (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0 CHECK(allowed IN (0,1)), updated_by INTEGER REFERENCES users(id), updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id, permission));
CREATE TABLE users (     id INTEGER PRIMARY KEY AUTOINCREMENT,     username TEXT NOT NULL UNIQUE COLLATE NOCASE,     email TEXT NOT NULL UNIQUE COLLATE NOCASE,     password_hash TEXT NOT NULL,     password_salt TEXT NOT NULL,     role TEXT NOT NULL CHECK (role IN ('owner', 'receptionist', 'doctor')),     doctor_id INTEGER REFERENCES doctors(id),     is_active INTEGER NOT NULL DEFAULT 1,     failed_attempts INTEGER NOT NULL DEFAULT 0,     locked_until DATETIME,     last_login_at DATETIME,     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, first_name TEXT, last_name TEXT,     CHECK (role != 'doctor' OR doctor_id IS NOT NULL) );
CREATE TABLE visit_procedures (id INTEGER PRIMARY KEY AUTOINCREMENT, visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE, procedure_name TEXT NOT NULL, fee INTEGER NOT NULL DEFAULT 0 CHECK(fee >= 0));
CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE, patient_id INTEGER NOT NULL REFERENCES patients(id), doctor_id INTEGER REFERENCES doctors(id), procedures TEXT NOT NULL DEFAULT '[]', notes TEXT, total INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, invoice_number TEXT, subtotal_amount INTEGER NOT NULL DEFAULT 0, discount_type TEXT NOT NULL DEFAULT 'none', discount_value INTEGER NOT NULL DEFAULT 0, discount_amount INTEGER NOT NULL DEFAULT 0, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, total_amount INTEGER NOT NULL DEFAULT 0, follow_up_date TEXT);

-- Indexes
CREATE INDEX idx_activity_user_action ON activity_log(user_id, action, id);
CREATE INDEX idx_appointments_date_time ON appointments(date DESC,time DESC);
CREATE INDEX idx_appointments_patient_date_time ON appointments(patient_id,date DESC,time DESC);
CREATE INDEX idx_appt_date ON appointments (date);
CREATE INDEX idx_appt_doctor_date ON appointments (doctor_id, date);
CREATE INDEX idx_appt_patient ON appointments (patient_id);
CREATE INDEX idx_appt_patient_followup ON appointments(patient_id,follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX idx_appt_status ON appointments (status);
CREATE INDEX idx_daily_tokens_date ON appointment_daily_tokens(clinic_date,token);
CREATE INDEX idx_drive_backups_account_date ON google_drive_backups(google_email, backup_kind, backup_date, created_at);
CREATE INDEX idx_drive_files_google_email_updated ON google_drive_files(google_email, updated_at);
CREATE INDEX idx_drive_files_patient ON google_drive_files(patient_id);
CREATE INDEX idx_drive_files_visit ON google_drive_files(visit_id);
CREATE INDEX idx_drive_folder_history_patient ON google_drive_folder_history(patient_id, archived_at);
CREATE INDEX idx_drive_folder_history_visit ON google_drive_folder_history(visit_id, archived_at);
CREATE INDEX idx_drive_oauth_expiry ON google_drive_oauth_states(expires_at);
CREATE INDEX idx_drive_sync_pending ON google_drive_sync_jobs(status, created_at);
CREATE UNIQUE INDEX idx_email_changes_new_token ON email_changes(new_token_hash);
CREATE INDEX idx_email_changes_user ON email_changes(user_id, created_at);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, success, created_at);
CREATE INDEX idx_login_attempts_user_time ON login_attempts(username, success, created_at);
CREATE INDEX idx_payments_patient ON payments(patient_id, created_at);
CREATE INDEX idx_payments_visit ON payments(visit_id);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_visit_procedures_visit ON visit_procedures(visit_id);
CREATE INDEX idx_visits_created_at ON visits(created_at DESC);
CREATE INDEX idx_visits_patient ON visits (patient_id);
CREATE INDEX idx_visits_patient_created ON visits(patient_id,created_at DESC);
CREATE INDEX idx_visits_patient_followup ON visits(patient_id,follow_up_date);
CREATE UNIQUE INDEX uq_active_slot ON appointments (doctor_id, date, time) WHERE status NOT IN ('cancelled', 'rejected', 'no_show');
CREATE UNIQUE INDEX uq_drive_patient_sync_job ON google_drive_sync_jobs(patient_id) WHERE job_kind='patient';
CREATE UNIQUE INDEX uq_visits_appointment ON visits(appointment_id);
CREATE UNIQUE INDEX uq_visits_invoice_number ON visits(invoice_number) WHERE invoice_number IS NOT NULL;

-- Triggers

-- Views

PRAGMA foreign_keys=ON;
