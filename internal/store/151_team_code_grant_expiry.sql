-- 额度码/并发码可设置兑换后有效期；逐笔兑换记录用于到期回收，避免共享码的兑换时间互相影响。
ALTER TABLE team_invites ADD COLUMN grant_validity_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_code_redemptions ADD COLUMN grant_expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_code_redemptions ADD COLUMN grant_expired INTEGER NOT NULL DEFAULT 0;
CREATE INDEX team_code_redemptions_expiry_idx
  ON team_code_redemptions(user_id, grant_expired, grant_expires_at);
