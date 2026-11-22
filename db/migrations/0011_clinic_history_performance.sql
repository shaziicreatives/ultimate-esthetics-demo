-- Query indexes for fast dashboard invoice loading and patient-specific history.
CREATE INDEX IF NOT EXISTS idx_visit_procedures_visit ON visit_procedures(visit_id);
CREATE INDEX IF NOT EXISTS idx_payments_visit ON payments(visit_id);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_patient_followup ON visits(patient_id,follow_up_date);
CREATE INDEX IF NOT EXISTS idx_appt_patient_followup ON appointments(patient_id,follow_up_date) WHERE follow_up_date IS NOT NULL;
