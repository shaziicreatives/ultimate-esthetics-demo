-- Ultimate Esthetics: full schema
-- Safe to run on a fresh database. It never drops anything.
-- Times default to UTC (CURRENT_TIMESTAMP); convert to Asia/Karachi (UTC+5) when displaying.
-- No users are seeded here on purpose: the first owner is created by the one-time setup route.

-- ---------------------------------------------------------------
-- DOCTORS (add / edit / remove, photo, specialty, bio)
-- "Remove" = is_active 0, so old appointments keep their doctor.
-- title = specialty. photo_key = file key in the R2 bucket.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  bio TEXT,
  photo_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- SECURITY: users, sessions, login attempts
-- Login = username + password. Email is for recovery only.
-- Roles: owner (everything), receptionist (appointments), doctor (own appointments).
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'receptionist', 'doctor')),
  doctor_id INTEGER REFERENCES doctors(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until DATETIME,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (role != 'doctor' OR doctor_id IS NOT NULL)
);

-- Only the HASH of the session token is stored; the real token lives in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Forgot password: token hash only, single use, short expiry.
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Change email from inside admin: the new email only becomes active after the link is clicked.
CREATE TABLE IF NOT EXISTS email_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- For brute-force protection (lockout and rate limiting).
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT COLLATE NOCASE,
  ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- PATIENTS (mini CRM)
-- phone must be stored in ONE normalized format (e.g. 923340005909) so duplicates cannot happen.
-- History = this patient's rows in appointments.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Staff-only notes, each with who wrote it and when.
CREATE TABLE IF NOT EXISTS patient_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- APPOINTMENTS
-- date = 'YYYY-MM-DD', time = 'HH:MM' (24h, e.g. '14:00')
-- status: pending, confirmed, done, cancelled, rejected, no_show
-- source: website (patient booked) or manual (receptionist added)
-- follow_up_date: staff-only list of due follow-ups. Nothing is ever sent to the patient.
-- Reschedule = update date/time on the same row.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  treatment TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'done', 'cancelled', 'rejected', 'no_show')),
  source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'manual')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  follow_up_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Double booking is blocked only for ACTIVE appointments.
-- Cancelled, rejected and no-show appointments free the slot again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
  ON appointments (doctor_id, date, time)
  WHERE status NOT IN ('cancelled', 'rejected', 'no_show');

CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments (date);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor_date ON appointments (doctor_id, date);

-- ---------------------------------------------------------------
-- SETTINGS (e.g. staff_notify_email: who gets the email on a new booking)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------
-- ACTIVITY LOG: who changed what, and when
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user_time ON login_attempts (username, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON login_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON patient_notes (patient_id);
CREATE INDEX IF NOT EXISTS idx_log_time ON activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_log_user ON activity_log (user_id);

-- ---------------------------------------------------------------
-- SAMPLE DOCTORS (placeholders; replace with real ones from the admin panel).
-- Only inserted when the doctors table is empty.
-- ---------------------------------------------------------------
INSERT INTO doctors (name, title, sort_order)
SELECT 'Dr. Ayesha Malik', 'Consultant Dermatologist', 1
WHERE NOT EXISTS (SELECT 1 FROM doctors);

INSERT INTO doctors (name, title, sort_order)
SELECT 'Dr. Hamza Raza', 'Hair Transplant Surgeon', 2
WHERE (SELECT COUNT(*) FROM doctors) = 1;

INSERT INTO doctors (name, title, sort_order)
SELECT 'Dr. Sana Iqbal', 'Aesthetic Physician', 3
WHERE (SELECT COUNT(*) FROM doctors) = 2;
