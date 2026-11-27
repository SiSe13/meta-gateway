package store_test

import (
	"fmt"
	"testing"
	"time"
)

// 兑换授予过期后只撤销对应余额与并发，并且重复清理保持幂等。
func TestExpireTeamCodeGrantsWithdrawsOnlyExpiredRedemptions(t *testing.T) {
	db := openTestDB(t)
	now := time.Unix(1_800_000_000, 0)
	if _, err := db.Exec(`INSERT INTO team_users(id,username,name,password_hash,role,policy_id,
		quota_total_tokens,quota_used_tokens,quota_total_cost,quota_used_cost,max_concurrent)
		VALUES(7,'member','Member','hash','member',1,700,100,17,2,9)`); err != nil {
		t.Fatal(err)
	}
	for index, values := range []struct {
		tokens  int64
		cost    float64
		slots   int
		expires int64
	}{
		{tokens: 200, cost: 5, slots: 3, expires: now.Add(-time.Second).Unix()},
		{tokens: 0, cost: 2, slots: 1, expires: now.Add(time.Hour).Unix()},
	} {
		result, err := db.Exec(`INSERT INTO team_invites(token_hash,label,policy_id,kind,expires_at) VALUES(?,?,1,'credit',0)`, fmt.Sprintf("test-%d", index+1), "")
		if err != nil {
			t.Fatal(err)
		}
		codeID, err := result.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO team_code_redemptions(code_id,user_id,quota_tokens,quota_cost,quota_concurrent,grant_expires_at)
			VALUES(?,?,?,?,?,?)`, codeID, 7, values.tokens, values.cost, values.slots, values.expires); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO team_concurrency_grants(user_id,quota_concurrent,grant_expires_at)
		VALUES(7,2,?)`, now.Add(-time.Second).Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO team_concurrency_grants(user_id,quota_concurrent,grant_expires_at)
		VALUES(7,1,?)`, now.Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}

	if err := db.ExpireTeamCodeGrants(7, now); err != nil {
		t.Fatal(err)
	}
	assertMemberLimits := func(wantTokens int64, wantCost float64, wantSlots int) {
		t.Helper()
		var tokens int64
		var cost float64
		var slots int
		if err := db.QueryRow(`SELECT quota_total_tokens,quota_total_cost,max_concurrent FROM team_users WHERE id=7`).Scan(&tokens, &cost, &slots); err != nil {
			t.Fatal(err)
		}
		if tokens != wantTokens || cost != wantCost || slots != wantSlots {
			t.Fatalf("member limits = (%d, %.2f, %d), want (%d, %.2f, %d)", tokens, cost, slots, wantTokens, wantCost, wantSlots)
		}
	}
	assertMemberLimits(500, 12, 4)
	var usedTokens int64
	var usedCost float64
	if err := db.QueryRow(`SELECT quota_used_tokens,quota_used_cost FROM team_users WHERE id=7`).Scan(&usedTokens, &usedCost); err != nil {
		t.Fatal(err)
	}
	if usedTokens != 100 || usedCost != 2 {
		t.Fatalf("usage was changed during expiry: (%d, %.2f)", usedTokens, usedCost)
	}
	if err := db.ExpireTeamCodeGrants(7, now); err != nil {
		t.Fatal(err)
	}
	assertMemberLimits(500, 12, 4)
	var expiredCount int
	if err := db.QueryRow(`SELECT count(*) FROM team_code_redemptions WHERE user_id=7 AND grant_expired=1`).Scan(&expiredCount); err != nil {
		t.Fatal(err)
	}
	if expiredCount != 1 {
		t.Fatalf("expired redemptions = %d, want only the expired grant", expiredCount)
	}
	if err := db.QueryRow(`SELECT count(*) FROM team_concurrency_grants WHERE user_id=7 AND grant_expired=1`).Scan(&expiredCount); err != nil {
		t.Fatal(err)
	}
	if expiredCount != 1 {
		t.Fatalf("expired direct grants = %d, want only the expired grant", expiredCount)
	}
}
