-- 授权分组改为用户可多选的模型与渠道授权集合；账户限制归属到用户。
ALTER TABLE team_users ADD COLUMN max_keys INTEGER NOT NULL DEFAULT 5 CHECK(max_keys BETWEEN 1 AND 100);
ALTER TABLE team_users ADD COLUMN rpm INTEGER NOT NULL DEFAULT 60 CHECK(rpm BETWEEN 1 AND 100000);
ALTER TABLE team_users ADD COLUMN allow_routing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_users ADD COLUMN allow_request_preferences INTEGER NOT NULL DEFAULT 0;

UPDATE team_users
SET max_keys = COALESCE((SELECT max_keys FROM team_policies WHERE id = team_users.policy_id), 5),
    rpm = COALESCE((SELECT rpm FROM team_policies WHERE id = team_users.policy_id), 60),
    allow_routing = COALESCE((SELECT allow_routing FROM team_policies WHERE id = team_users.policy_id), 0),
    allow_request_preferences = COALESCE((SELECT allow_request_preferences FROM team_policies WHERE id = team_users.policy_id), 0);

CREATE TABLE team_user_policies (
  user_id INTEGER NOT NULL REFERENCES team_users(id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES team_policies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, policy_id)
);
INSERT INTO team_user_policies(user_id, policy_id)
SELECT id, policy_id FROM team_users;
CREATE INDEX team_user_policies_policy ON team_user_policies(policy_id, user_id);
CREATE TRIGGER team_user_policy_default_insert AFTER INSERT ON team_users
BEGIN
  INSERT OR IGNORE INTO team_user_policies(user_id, policy_id) VALUES(NEW.id, NEW.policy_id);
END;

ALTER TABLE team_policies DROP COLUMN max_keys;
ALTER TABLE team_policies DROP COLUMN rpm;
ALTER TABLE team_policies DROP COLUMN allow_routing;
ALTER TABLE team_policies DROP COLUMN allow_request_preferences;
