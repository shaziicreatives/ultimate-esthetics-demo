-- Patients Table
CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL
);

-- Initial Doctors Data
INSERT OR IGNORE INTO doctors (id, name, title) VALUES 
(1, 'Dr. Ayesha Malik', 'Consultant Dermatologist'),
(2, 'Dr. Hamza Raza', 'Hair Transplant Surgeon'),
(3, 'Dr. Sana Iqbal', 'Aesthetic Physician');

-- Appointments Table with Double-Booking Prevention
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL,
    patient_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    treatment TEXT,
    status TEXT DEFAULT 'booked', -- booked, cancelled, completed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    UNIQUE(doctor_id, date, time) -- Double booking rokne ke liye
);
