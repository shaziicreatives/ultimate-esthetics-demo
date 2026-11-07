-- Safe Enterprise Schema for Ultimate Esthetics

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

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT COLLATE NOCASE,
    ip TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patient_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- Partial index: Sirf active bookings par unique constraint rahega taake cancel/reject hone par slot khali ho jaye
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
ON appointments (doctor_id, date, time)
WHERE status NOT IN ('cancelled', 'rejected', 'no_show');

-- Default Doctors Insertion (agar table khali ho)
INSERT INTO doctors (name, title, sort_order) SELECT 'Dr. Ayesha Malik', 'Consultant Dermatologist', 1 WHERE NOT EXISTS (SELECT 1 FROM doctors);
INSERT INTO doctors (name, title, sort_order) SELECT 'Dr. Hamza Raza', 'Hair Transplant Surgeon', 2 WHERE (SELECT COUNT(*) FROM doctors) == 1;
INSERT INTO doctors (name, title, sort_order) SELECT 'Dr. Sana Iqbal', 'Aesthetic Physician', 3 WHERE (SELECT COUNT(*) FROM doctors) == 2;
