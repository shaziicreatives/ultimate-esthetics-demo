DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS doctors;

CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    bio TEXT,
    photo TEXT,
    is_active INTEGER DEFAULT 1
);

INSERT OR IGNORE INTO doctors (id, name, title, bio, is_active) VALUES 
(1, 'Dr. Ayesha Malik', 'Consultant Dermatologist', 'Acne, scars, pigmentation and skin rejuvenation.', 1),
(2, 'Dr. Hamza Raza', 'Hair Transplant Surgeon', 'Hair transplant, PRP, exosomes and PRGF.', 1),
(3, 'Dr. Sana Iqbal', 'Aesthetic Physician', 'Hydrafacial, laser, glow drips and body care.', 1);

CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    treatment TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id)
);

-- Partial index: Sirf active bookings par unique constraint rahega taake cancel hone par slot khali ho jaye
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot 
ON appointments(doctor_id, date, time) 
WHERE status IN ('pending', 'confirmed');
