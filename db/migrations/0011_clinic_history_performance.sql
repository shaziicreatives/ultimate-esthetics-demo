-- Query indexes for fast dashboard invoice loading and patient-specific history.
CREATE INDEX IF NOT EXISTS idx_visit_procedures_visit ON visit_procedures(visit_id);
CREATE INDEX IF NOT EXISTS idx_payments_visit ON payments(visit_id);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at DESC);
