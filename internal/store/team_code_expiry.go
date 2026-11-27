package store

import (
	"database/sql"
	"time"
)

// ExpireTeamCodeGrants 回收某个账户已到期的额度码与并发码授予。
func (db *DB) ExpireTeamCodeGrants(userID int64, now time.Time) error {
	return expireTeamCodeGrants(db.DB, userID, now)
}

func expireTeamCodeGrants(db *sql.DB, userID int64, now time.Time) error {
	if userID <= 0 {
		return nil
	}
	var hasExpired int
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM team_code_redemptions
		WHERE user_id=? AND grant_expired=0 AND grant_expires_at>0 AND grant_expires_at<=?)
		OR EXISTS(SELECT 1 FROM team_concurrency_grants
		WHERE user_id=? AND grant_expired=0 AND grant_expires_at>0 AND grant_expires_at<=?)`,
		userID, now.Unix(), userID, now.Unix()).Scan(&hasExpired); err != nil {
		return err
	}
	if hasExpired == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var quotaTokens int64
	var quotaCost float64
	var quotaConcurrent int
	rows, err := tx.Query(`UPDATE team_code_redemptions SET grant_expired=1
		WHERE user_id=? AND grant_expired=0 AND grant_expires_at>0 AND grant_expires_at<=?
		RETURNING quota_tokens,quota_cost,quota_concurrent`, userID, now.Unix())
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		var tokens int64
		var cost float64
		var concurrent int
		if err := rows.Scan(&tokens, &cost, &concurrent); err != nil {
			rows.Close()
			return err
		}
		quotaTokens += tokens
		quotaCost += cost
		quotaConcurrent += concurrent
		count++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	rows, err = tx.Query(`UPDATE team_concurrency_grants SET grant_expired=1
		WHERE user_id=? AND grant_expired=0 AND grant_expires_at>0 AND grant_expires_at<=?
		RETURNING quota_concurrent`, userID, now.Unix())
	if err != nil {
		return err
	}
	for rows.Next() {
		var concurrent int
		if err := rows.Scan(&concurrent); err != nil {
			rows.Close()
			return err
		}
		quotaConcurrent += concurrent
		count++
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if count == 0 {
		return tx.Commit()
	}
	if quotaTokens != 0 || quotaCost != 0 || quotaConcurrent != 0 {
		if _, err := tx.Exec(`UPDATE team_users SET
			quota_total_tokens=CASE WHEN quota_total_tokens>=? THEN quota_total_tokens-? ELSE MAX(quota_used_tokens,1) END,
			quota_total_cost=CASE WHEN quota_total_cost>=? THEN quota_total_cost-? ELSE MAX(quota_used_cost,0.000001) END,
			max_concurrent=MAX(1,max_concurrent-?) WHERE id=?`, quotaTokens, quotaTokens, quotaCost, quotaCost, quotaConcurrent, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
