-- 注册码可将新账户加入多个授权分组；保留 team_invites.policy_id 作为旧版主分组。
CREATE TABLE team_invite_policies (
  invite_id INTEGER NOT NULL REFERENCES team_invites(id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES team_policies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(invite_id, policy_id),
  UNIQUE(invite_id, position)
);
CREATE INDEX team_invite_policies_policy ON team_invite_policies(policy_id, invite_id);
