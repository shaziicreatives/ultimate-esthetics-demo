-- One-time replay protection for short-lived clinic-to-agent assertions.
-- Contains only assertion IDs and expiry timestamps; no patient or session data.
CREATE TABLE IF NOT EXISTS ai_agent_bridge_assertions (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_agent_bridge_assertions_expiry
  ON ai_agent_bridge_assertions(expires_at);
