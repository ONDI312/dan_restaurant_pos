CREATE TABLE IF NOT EXISTS web_login_attempts (
    username TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ
);

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'system';
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS entity_id TEXT;

CREATE INDEX IF NOT EXISTS idx_web_login_attempts_locked_until
    ON web_login_attempts (locked_until);
