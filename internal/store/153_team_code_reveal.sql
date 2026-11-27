-- 管理端需要在生成后重新取回兑换码；仍以哈希校验，只额外保存主密钥加密副本。
ALTER TABLE team_invites ADD COLUMN token_enc TEXT NOT NULL DEFAULT '';
