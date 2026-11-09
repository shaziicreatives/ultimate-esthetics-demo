-- Compatibility for the live clinic database, whose original visits table predates
-- the normalized visits API. Existing legacy columns are preserved.
ALTER TABLE visits ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE visits ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE visits ADD COLUMN follow_up_date TEXT;
UPDATE visits SET user_id=created_by WHERE user_id IS NULL AND created_by IS NOT NULL;
UPDATE visits SET total_amount=total WHERE total_amount=0 AND total IS NOT NULL;
