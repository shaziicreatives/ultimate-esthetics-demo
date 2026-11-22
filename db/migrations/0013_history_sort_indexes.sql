-- Composite indexes keep patient-specific history and the dashboard's recent appointment
-- ordering efficient as the clinic grows.
CREATE INDEX IF NOT EXISTS idx_appointments_date_time ON appointments(date DESC, time DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date_time ON appointments(patient_id, date DESC, time DESC);
CREATE INDEX IF NOT EXISTS idx_visits_patient_created ON visits(patient_id, created_at DESC);
