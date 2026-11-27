package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestMemberRedemptionHistoryIsScopedToAccount(t *testing.T) {
	e := newTeamTestEnv(t)
	e.enable()
	alice := e.member("history-alice", "member")
	bob := e.member("history-bob", "member")
	_, codes := mintCodes(t, e, map[string]any{
		"kind": "credit", "count": 1, "quota_tokens": 1200, "quota_cost": 2.5, "max_uses": 3,
	})
	for _, member := range []*teamTestBrowser{alice, bob} {
		member.request("POST", "/me/redeem", map[string]any{"code": codes[0]}, http.StatusOK)
	}
	_, aliceKey := alice.key("history-key")
	_, bobKey := bob.key("history-key")
	legacyCodesRaw := e.admin("POST", "/admin/redemption-codes", map[string]any{"count": 2, "quota_tokens": 300}, http.StatusOK)
	var legacyCodes struct {
		Items []struct {
			Code string `json:"code"`
		} `json:"items"`
	}
	if err := json.Unmarshal(legacyCodesRaw, &legacyCodes); err != nil || len(legacyCodes.Items) != 2 {
		t.Fatalf("decode personal redemption codes: %v, body=%s", err, legacyCodesRaw)
	}
	for i, key := range []string{aliceKey, bobKey} {
		code, _, _ := e.call(http.DefaultClient, "POST", "/v1/redemption/redeem", map[string]any{"code": legacyCodes.Items[i].Code}, key, "")
		if code != http.StatusOK {
			t.Fatalf("redeem personal code for member %d: status=%d", i, code)
		}
	}
	// 关闭团队模式会撤销成员会话，但不能删除账号的兑换记录。
	e.setMode("personal")
	if code, _, _ := e.call(http.DefaultClient, "GET", "/me/redemptions", nil, "", ""); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated redemption history status = %d, want %d", code, http.StatusUnauthorized)
	}
	for _, member := range []*teamTestBrowser{alice, bob} {
		member.request("GET", "/me/redemptions", nil, http.StatusUnauthorized)
	}
	// 重新启用成员登录后，记录仍只能由所属账号查询。
	e.setMode("team")
	alice.login("history-alice", "member-password-123")
	bob.login("history-bob", "member-password-123")

	type redemption struct {
		CreatedAt       int64   `json:"created_at"`
		QuotaTokens     int64   `json:"quota_tokens"`
		QuotaCost       float64 `json:"quota_cost"`
		QuotaConcurrent int     `json:"quota_concurrent"`
		GrantExpiresAt  int64   `json:"grant_expires_at"`
		Target          string  `json:"target"`
	}
	for _, member := range []*teamTestBrowser{alice, bob} {
		raw := member.request("GET", "/me/redemptions", nil, http.StatusOK)
		var items []redemption
		if err := json.Unmarshal(raw, &items); err != nil {
			t.Fatalf("decode user %d redemptions: %v", member.userID, err)
		}
		if len(items) != 2 {
			t.Fatalf("user %d redemptions = %+v, want its account voucher and personal key voucher", member.userID, items)
		}
		var hasAccountGrant, hasPersonalGrant bool
		for _, item := range items {
			if item.CreatedAt == 0 || item.QuotaConcurrent != 0 || item.GrantExpiresAt != 0 {
				t.Fatalf("user %d has malformed redemption history item: %+v", member.userID, item)
			}
			if item.QuotaTokens == 1200 && item.QuotaCost == 2.5 {
				if item.Target != "account" {
					t.Fatalf("account grant target = %q, want account", item.Target)
				}
				hasAccountGrant = true
			}
			if item.QuotaTokens == 300 && item.QuotaCost == 0 {
				if item.Target != "api_key" {
					t.Fatalf("personal grant target = %q, want api_key", item.Target)
				}
				hasPersonalGrant = true
			}
		}
		if !hasAccountGrant || !hasPersonalGrant {
			t.Fatalf("user %d redemptions = %+v, want both account and personal grants", member.userID, items)
		}
		if strings.Contains(string(raw), codes[0]) || strings.Contains(string(raw), legacyCodes.Items[0].Code) || strings.Contains(string(raw), legacyCodes.Items[1].Code) {
			t.Fatalf("user %d redemption history exposed a voucher: %s", member.userID, raw)
		}
	}
}
