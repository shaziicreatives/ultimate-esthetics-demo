-- Email change verification: store only hashed, one-time tokens.
CREATE TABLE IF NOT EXISTS email_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 new_email TEXT NOT NULL COLLATE NOCASE,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at DATETIME NOT NULL,
 used_at DATETIME,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_changes_user ON email_changes(user_id, created_at);
