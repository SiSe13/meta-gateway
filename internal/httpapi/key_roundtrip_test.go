package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/lan/meta-gateway/internal/domain"
)

// The regression tests here pin field-level round-trips through the admin
// API. A column can be write-only for a whole feature cycle unless a test
// asserts it survives create → list → partial update.

func keyByID(t *testing.T, base string, id float64) map[string]any {
	t.Helper()
	// The list endpoint returns a bare JSON array, so parse the raw body
	// (adminCall only decodes objects).
	status, _, raw := adminCall(t, base, http.MethodGet, "/admin/downstream-keys", nil)
	if status != http.StatusOK {
		t.Fatalf("list keys status = %d", status)
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		t.Fatalf("decode key list: %v", err)
	}
	for _, entry := range items {
		if entryID, _ := entry["id"].(float64); entryID == id {
			return entry
		}
	}
	t.Fatalf("key %v not found in list", id)
	return nil
}

func TestCreateKeyResponseEchoesExpiryAndIPs(t *testing.T) {
	srv, _, _ := revealTestServer(t)

	status, created, _ := adminCall(t, srv.URL, http.MethodPost, "/admin/downstream-keys", map[string]any{
		"name":        "echo",
		"expires_at":  "2027-01-01T00:00:00Z",
		"allowed_ips": "10.0.0.1",
	})
	if status != http.StatusCreated {
		t.Fatalf("create status = %d", status)
	}
	if created["expires_at"] != "2027-01-01T00:00:00Z" {
		t.Fatalf("expires_at = %v, want echo", created["expires_at"])
	}
	if created["allowed_ips"] != "10.0.0.1" {
		t.Fatalf("allowed_ips = %v, want echo", created["allowed_ips"])
	}
}

func TestDownstreamKeyListIncludesOwningUserName(t *testing.T) {
	srv, db, _ := revealTestServer(t)

	if _, err := db.Exec(`INSERT INTO team_users(username,name,password_hash,role,policy_id)
		VALUES('alice-login','Alice Example','hash','member',1)`); err != nil {
		t.Fatalf("insert team user: %v", err)
	}
	var userID int64
	if err := db.QueryRow(`SELECT id FROM team_users WHERE username='alice-login'`).Scan(&userID); err != nil {
		t.Fatalf("read team user ID: %v", err)
	}
	status, created, _ := adminCall(t, srv.URL, http.MethodPost, "/admin/downstream-keys", map[string]any{
		"name": "alice-key",
	})
	if status != http.StatusCreated {
		t.Fatalf("create key status = %d", status)
	}
	keyID := created["id"].(float64)
	if _, err := db.Exec(`UPDATE downstream_keys SET user_id=? WHERE id=?`, userID, int64(keyID)); err != nil {
		t.Fatalf("bind key to user: %v", err)
	}

	entry := keyByID(t, srv.URL, keyID)
	if entry["owner_name"] != "Alice Example" || entry["owner_username"] != "alice-login" {
		t.Fatalf("owner identity = %v/%v, want Alice Example/alice-login", entry["owner_name"], entry["owner_username"])
	}
}

// routeGroupOf reads route_group_name from a key JSON entry; the field is
// omitempty on the wire, so an absent key means "".
func routeGroupOf(entry map[string]any) string {
	if v, ok := entry["route_group_name"]; ok {
		return v.(string)
	}
	return ""
}

func TestDownstreamKeyRouteGroupRoundTrip(t *testing.T) {
	srv, _, _ := revealTestServer(t)
	base := srv.URL

	status, created, _ := adminCall(t, base, http.MethodPost, "/admin/downstream-keys", map[string]any{
		"name":             "grouped",
		"route_group_name": "B",
	})
	if status != http.StatusCreated {
		t.Fatalf("create status = %d", status)
	}
	if got, _ := created["route_group_name"].(string); got != "B" {
		t.Fatalf("create response route_group_name = %v, want B", created["route_group_name"])
	}
	id, _ := created["id"].(float64)

	// The list endpoint must read the stored value.
	if entry := keyByID(t, base, id); routeGroupOf(entry) != "B" {
		t.Fatalf("listed route_group_name = %v, want B", entry["route_group_name"])
	}

	// A partial update that omits the group must not zero it.
	status, _, _ = adminCall(t, base, http.MethodPut, fmt.Sprintf("/admin/downstream-keys/%d", int64(id)), map[string]any{
		"name": "renamed",
	})
	if status != http.StatusOK {
		t.Fatalf("partial update status = %d", status)
	}
	if entry := keyByID(t, base, id); routeGroupOf(entry) != "B" {
		t.Fatalf("route_group_name after partial update = %v, want B (must survive)", entry["route_group_name"])
	}

	// Explicit updates still apply, and clearing persists.
	status, _, _ = adminCall(t, base, http.MethodPut, fmt.Sprintf("/admin/downstream-keys/%d", int64(id)), map[string]any{
		"route_group_name": "C",
	})
	if status != http.StatusOK {
		t.Fatalf("group update status = %d", status)
	}
	if entry := keyByID(t, base, id); routeGroupOf(entry) != "C" {
		t.Fatalf("route_group_name after explicit update = %v, want C", entry["route_group_name"])
	}
	status, _, _ = adminCall(t, base, http.MethodPut, fmt.Sprintf("/admin/downstream-keys/%d", int64(id)), map[string]any{
		"route_group_name": "",
	})
	if status != http.StatusOK {
		t.Fatalf("clear status = %d", status)
	}
	if entry := keyByID(t, base, id); routeGroupOf(entry) != "" {
		t.Fatalf("route_group_name after clear = %v, want empty (default routing)", entry["route_group_name"])
	}
}

func TestDownstreamKeyListIncludesUsageAndCurrentConcurrency(t *testing.T) {
	srv, db, _ := revealTestServer(t)
	status, created, _ := adminCall(t, srv.URL, http.MethodPost, "/admin/downstream-keys", map[string]any{
		"name": "team-token",
	})
	if status != http.StatusCreated {
		t.Fatalf("create key status = %d", status)
	}
	keyID := int64(created["id"].(float64))
	if _, err := db.Exec(`UPDATE team_settings SET mode='team' WHERE id=1`); err != nil {
		t.Fatalf("enable team mode: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO team_policies(name) VALUES('DeepSeek')`); err != nil {
		t.Fatalf("seed authorization group: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO team_users(username,name,password_hash,role,policy_id) VALUES('key-owner','Owner','hash','member',1)`); err != nil {
		t.Fatalf("seed team owner: %v", err)
	}
	var userID int64
	if err := db.QueryRow(`SELECT id FROM team_users WHERE username='key-owner'`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO team_user_policies(user_id,policy_id) VALUES(?,2)`, userID); err != nil {
		t.Fatalf("add second authorization group: %v", err)
	}
	if _, err := db.Exec(`UPDATE downstream_keys SET user_id=? WHERE id=?`, userID, keyID); err != nil {
		t.Fatalf("bind key to team owner: %v", err)
	}
	seed := func(requestID string, tokens int, cost float64, at time.Time) {
		t.Helper()
		id, err := db.Usage.Insert(&domain.UsageRecord{
			RequestID: requestID, DownstreamKeyID: keyID, ChannelID: 1,
			Model: "gpt-test", Path: "chat/completions", TotalTokens: tokens,
			Status: 200, Cost: cost,
		})
		if err != nil {
			t.Fatalf("seed usage: %v", err)
		}
		if _, err := db.Exec(`UPDATE usage_records SET created_at=? WHERE id=?`, at.UTC().Format("2006-01-02 15:04:05"), id); err != nil {
			t.Fatalf("date usage: %v", err)
		}
	}
	now := time.Now()
	seed("today", 10, 0.25, now)
	seed("recent", 20, 0.5, now.Add(-10*24*time.Hour))

	entry := keyByID(t, srv.URL, float64(keyID))
	status, _, activityBody := adminCall(t, srv.URL, http.MethodGet, "/admin/downstream-keys/activity", nil)
	if status != http.StatusOK {
		t.Fatalf("key activity status = %d", status)
	}
	var activities []map[string]any
	if err := json.Unmarshal([]byte(activityBody), &activities); err != nil {
		t.Fatalf("decode key activity: %v", err)
	}
	if len(activities) != 1 || activities[0]["id"] != float64(keyID) || activities[0]["current_concurrent"] != float64(0) {
		t.Fatalf("key activity = %v, want idle key %d", activities, keyID)
	}
	if entry["today_tokens"] != float64(10) || entry["today_cost"] != 0.25 {
		t.Fatalf("today usage = %v / %v, want 10 tokens / 0.25", entry["today_tokens"], entry["today_cost"])
	}
	if entry["last_30_days_tokens"] != float64(30) || entry["last_30_days_cost"] != 0.75 {
		t.Fatalf("30-day usage = %v / %v, want 30 tokens / 0.75", entry["last_30_days_tokens"], entry["last_30_days_cost"])
	}
	if entry["current_concurrent"] != float64(0) {
		t.Fatalf("current concurrency = %v, want 0 when idle", entry["current_concurrent"])
	}
	groups, ok := entry["authorization_groups"].([]any)
	if !ok || len(groups) != 2 || groups[0] != "Default" || groups[1] != "DeepSeek" {
		t.Fatalf("authorization groups = %v, want Default and DeepSeek", entry["authorization_groups"])
	}
}

func TestCredentialRejectsInvalidStatus(t *testing.T) {
	srv, _, _ := revealTestServer(t)
	base := srv.URL

	status, site, _ := adminCall(t, base, http.MethodPost, "/admin/sites", map[string]any{
		"name":     "status-check",
		"base_url": "https://api.example.com",
		"platform": "openai",
	})
	if status != http.StatusCreated {
		t.Fatalf("site create status = %d", status)
	}
	siteID, _ := site["id"].(float64)

	status, _, _ = adminCall(t, base, http.MethodPost, fmt.Sprintf("/admin/sites/%d/credentials", int64(siteID)), map[string]any{
		"kind":   "api_key",
		"secret": "sk-1",
		"status": "bogus",
	})
	if status != http.StatusBadRequest {
		t.Fatalf("bogus credential status = %d, want 400", status)
	}
}

func TestUpdateChannelOmittedFieldsKeepPriorityWeight(t *testing.T) {
	srv, _, _ := revealTestServer(t)
	base := srv.URL

	status, conn := postConnection(t, base, "admin-secret", map[string]any{
		"name":      "patched",
		"base_url":  "https://api.example.com",
		"secret":    "sk-live",
		"type_hint": "openai-compatible",
	})
	if status != http.StatusCreated {
		t.Fatalf("connection status = %d", status)
	}
	channelID := conn.Channel.ID

	// Establish a non-zero baseline through an explicit update.
	status, _, _ = adminCall(t, base, http.MethodPut, fmt.Sprintf("/admin/channels/%d", channelID), map[string]any{
		"priority": 7,
		"weight":   33,
	})
	if status != http.StatusOK {
		t.Fatalf("baseline update status = %d", status)
	}

	// Patch only the name: priority/weight must survive. They used to be
	// overwritten unconditionally, so omitting them zeroed both.
	status, _, _ = adminCall(t, base, http.MethodPut, fmt.Sprintf("/admin/channels/%d", channelID), map[string]any{
		"name": "renamed-only",
	})
	if status != http.StatusOK {
		t.Fatalf("name-only update status = %d", status)
	}

	status, _, raw := adminCall(t, base, http.MethodGet, "/admin/channels", nil)
	if status != http.StatusOK {
		t.Fatalf("channel list status = %d", status)
	}
	var channels []struct {
		ID       int64  `json:"id"`
		Name     string `json:"name"`
		Priority int    `json:"priority"`
		Weight   int    `json:"weight"`
	}
	if err := json.Unmarshal([]byte(raw), &channels); err != nil {
		t.Fatalf("decode channels: %v", err)
	}
	for _, ch := range channels {
		if ch.ID == channelID {
			if ch.Name != "renamed-only" || ch.Priority != 7 || ch.Weight != 33 {
				t.Fatalf("channel after partial patch = %+v, want name=renamed-only priority=7 weight=33", ch)
			}
			return
		}
	}
	t.Fatalf("channel %d not found", channelID)
}
