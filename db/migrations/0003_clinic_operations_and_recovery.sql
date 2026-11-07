-- Clinic operations and owner recovery settings. Apply to D1 before using these APIs.
CREATE TABLE IF NOT EXISTS visits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
 patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 doctor_id INTEGER NOT NULL REFERENCES doctors(id),
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 notes TEXT,
 total_amount INTEGER NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
 follow_up_date TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS visit_procedures (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
 procedure_name TEXT NOT NULL,
 fee INTEGER NOT NULL DEFAULT 0 CHECK(fee >= 0)
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
 patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
 amount INTEGER NOT NULL CHECK(amount > 0),
 method TEXT NOT NULL DEFAULT 'cash',
 reference TEXT,
 received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clinic_security_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL,
 updated_by INTEGER REFERENCES users(id),
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_permissions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 permission TEXT NOT NULL,
 allowed INTEGER NOT NULL DEFAULT 0 CHECK(allowed IN (0,1)),
 updated_by INTEGER REFERENCES users(id),
 updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, permission)
);
CREATE TABLE IF NOT EXISTS email_verification_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at DATETIME NOT NULL,
 used_at DATETIME,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id, created_at);
INSERT OR IGNORE INTO settings(key,value) VALUES ('owner_recovery_email','imat2025maths@gmail.com');
