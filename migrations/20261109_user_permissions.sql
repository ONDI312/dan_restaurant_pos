ALTER TABLE users
    ADD COLUMN IF NOT EXISTS permissions_customized BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_name TEXT NOT NULL,
    PRIMARY KEY (user_id, permission_name)
);
