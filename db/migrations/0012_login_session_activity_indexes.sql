-- Keep login, session, and activity-log lookups fast as authentication history grows.
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_time ON login_attempts(username, success, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, success, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_user_action ON activity_log(user_id, action, id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
