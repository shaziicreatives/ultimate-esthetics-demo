-- Two-step email change: approve at existing address, then confirm new address.
ALTER TABLE email_changes ADD COLUMN current_verified_at DATETIME;
ALTER TABLE email_changes ADD COLUMN new_token_hash TEXT;
ALTER TABLE email_changes ADD COLUMN new_expires_at DATETIME;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_changes_new_token ON email_changes(new_token_hash);
