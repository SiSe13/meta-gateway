-- Team accounts start with one in-flight relay slot. Concurrency vouchers add
-- more slots to the account-wide limit.
ALTER TABLE team_users ADD COLUMN max_concurrent INTEGER NOT NULL DEFAULT 5 CHECK(max_concurrent BETWEEN 1 AND 10000);

-- A concurrency voucher is stored as a credit code with only this face-value
-- column set; the API exposes it as its own kind without rebuilding the table
-- and disturbing redemption foreign keys.
ALTER TABLE team_invites ADD COLUMN quota_concurrent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE team_code_redemptions ADD COLUMN quota_concurrent INTEGER NOT NULL DEFAULT 0;
