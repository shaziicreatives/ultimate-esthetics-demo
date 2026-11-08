-- Clinic patient tokens, permanent invoice numbering, discounts and Drive/push integration settings.
-- Apply to the production D1 only after reviewing the preview deployment.
CREATE TABLE IF NOT EXISTS daily_token_counters (
  clinic_date TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS appointment_daily_tokens (
  appointment_id INTEGER PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
  clinic_date TEXT NOT NULL,
  token INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(clinic_date, token)
);
CREATE INDEX IF NOT EXISTS idx_daily_tokens_date ON appointment_daily_tokens(clinic_date, token);

ALTER TABLE visits ADD COLUMN invoice_number TEXT;
ALTER TABLE visits ADD COLUMN subtotal_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visits ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE visits ADD COLUMN discount_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visits ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_invoice_number ON visits(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visits_appointment ON visits(appointment_id);

CREATE TABLE IF NOT EXISTS invoice_sequence (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_number INTEGER NOT NULL
);
INSERT OR IGNORE INTO invoice_sequence(id,last_number) VALUES(1,1000);

ALTER TABLE patients ADD COLUMN referred_by_patient_id INTEGER REFERENCES patients(id);
ALTER TABLE patients ADD COLUMN referral_notes TEXT;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS clinic_integrations (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
