ALTER TABLE team_sessions ADD COLUMN device TEXT NOT NULL DEFAULT '';
ALTER TABLE team_sessions ADD COLUMN ip_address TEXT NOT NULL DEFAULT '';
ALTER TABLE team_sessions ADD COLUMN login_method TEXT NOT NULL DEFAULT '';
ALTER TABLE team_sessions ADD COLUMN last_active_at INTEGER NOT NULL DEFAULT 0;
UPDATE team_sessions SET last_active_at=created_at WHERE last_active_at=0;
