-- 管理员直接增加的临时并发额度，到期后按授予记录回收。
CREATE TABLE team_concurrency_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES team_users(id) ON DELETE CASCADE,
  quota_concurrent INTEGER NOT NULL CHECK(quota_concurrent BETWEEN 1 AND 10000),
  grant_expires_at INTEGER NOT NULL DEFAULT 0,
  grant_expired INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX team_concurrency_grants_expiry_idx
  ON team_concurrency_grants(user_id, grant_expired, grant_expires_at);
