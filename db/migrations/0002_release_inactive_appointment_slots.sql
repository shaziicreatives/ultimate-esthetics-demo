-- One-time repair for databases created with the older table-level UNIQUE constraint.
-- Rebuild appointments so rejected/cancelled/no-show rows release their time slot.
PRAGMA foreign_keys = OFF;

CREATE TABLE appointments_rebuilt (
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

INSERT INTO appointments_rebuilt
  (id, doctor_id, patient_id, date, time, treatment, status, source, created_by, follow_up_date, created_at, updated_at)
SELECT id, doctor_id, patient_id, date, time, treatment, status, source, created_by, follow_up_date, created_at, updated_at
FROM appointments;

DROP TABLE appointments;
ALTER TABLE appointments_rebuilt RENAME TO appointments;

CREATE UNIQUE INDEX uq_active_slot
  ON appointments (doctor_id, date, time)
  WHERE status NOT IN ('cancelled', 'rejected', 'no_show');

CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments (date);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor_date ON appointments (doctor_id, date);

PRAGMA foreign_keys = ON;
