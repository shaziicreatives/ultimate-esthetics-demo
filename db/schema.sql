DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS slots;

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  doctor TEXT NOT NULL,
  service TEXT,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  is_booked INTEGER DEFAULT 0,
  UNIQUE(date, time)
);
