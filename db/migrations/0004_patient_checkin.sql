-- Persist the reception check-in separately from visit completion.
ALTER TABLE appointments ADD COLUMN checked_in_at DATETIME;
