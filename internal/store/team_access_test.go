package store_test

import (
	"fmt"
	"testing"

	"github.com/lan/meta-gateway/internal/domain"
	"github.com/lan/meta-gateway/internal/store"
)

// Revoking personal routing withdraws the arrangement, not the account: a key
// that never bound a plan keeps working on the site's own order, and only an
// explicitly bound key is refused.
func TestRevokedPersonalRoutingRefusesOnlyExplicitlyBoundKeys(t *testing.T) {
	db := openTestDB(t)
	if _, err := db.Exec(`UPDATE team_settings SET mode='team' WHERE id=1;
		INSERT INTO team_users(id,username,name,password_hash,policy_id) VALUES(7,'member','Member','hash',1);
		INSERT INTO team_route_plans(id,user_id,name,members_json,is_default) VALUES(3,7,'Mine','{"routes":{"model":[{"id":11,"weight":1}]}}',1)`); err != nil {
		t.Fatal(err)
	}
	unbound := teamKeyRiding(t, db, 0)
	bound := teamKeyRiding(t, db, 3)

	if access, err := db.DownstreamKey.ResolveTeamAccess(unbound); err != nil {
		t.Fatalf("unbound key refused after the permission was revoked: %v", err)
	} else if access.Arranged("model") {
		t.Fatal("a revoked arrangement still applied to an unbound key")
	}
	if _, err := db.DownstreamKey.ResolveTeamAccess(bound); err == nil {
		t.Fatal("explicitly bound key was not refused")
	}

	// The same unbound key keeps its arrangement while the permission is on.
	if _, err := db.Exec(`UPDATE team_users SET allow_routing=1 WHERE id=7`); err != nil {
		t.Fatal(err)
	}
	access, err := db.DownstreamKey.ResolveTeamAccess(unbound)
	if err != nil || !access.Arranged("model") {
		t.Fatalf("granted permission did not apply the arrangement: %v", err)
	}
}

// Multiple authorization groups combine model and channel grants; account
// limits and personal features remain on the user record.
func TestTeamAccessUnionsAssignedAuthorizationGroups(t *testing.T) {
	db := openTestDB(t)
	if _, err := db.Exec(`UPDATE team_settings SET mode='team' WHERE id=1;
		UPDATE team_policies SET models_json='["gpt-model"]',members_json='[11]' WHERE id=1;
		INSERT INTO team_users(id,username,name,password_hash,policy_id) VALUES(7,'member','Member','hash',1);
		INSERT INTO team_policies(name,models_json,members_json) VALUES('DS','["ds-model"]','[22]');
		INSERT INTO team_user_policies(user_id,policy_id) VALUES(7,2);
		UPDATE team_users SET rpm=23,allow_routing=1,allow_request_preferences=1 WHERE id=7`); err != nil {
		t.Fatal(err)
	}
	key := teamKeyRiding(t, db, 0)
	access, err := db.DownstreamKey.ResolveTeamAccess(key)
	if err != nil {
		t.Fatal(err)
	}
	if !access.AllowsModel("gpt-model") || !access.AllowsModel("ds-model") || !access.AllowsGrant(11) || !access.AllowsGrant(22) {
		t.Fatalf("authorization groups were not unioned: %+v", access)
	}
	if access.RPM != 23 || !access.AllowRouting || !access.AllowRequestPreferences {
		t.Fatalf("account-level controls were not loaded from the user: %+v", access)
	}
}

// teamKeyRiding creates a team key for user 7 bound to planID (0 = unbound).
func teamKeyRiding(t *testing.T, db *store.DB, planID int64) *domain.DownstreamKey {
	t.Helper()
	id, err := db.DownstreamKey.Create(&domain.DownstreamKey{TokenHash: fmt.Sprintf("test-%d", planID), Name: "key", Enabled: true, Scopes: "relay"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, err := db.Exec(`UPDATE downstream_keys SET user_id=7, team_plan_id=? WHERE id=?`, planID, id); err != nil {
		t.Fatalf("bind key: %v", err)
	}
	db.DownstreamKey.Invalidate(id)
	key, err := db.DownstreamKey.GetByID(id)
	if err != nil || key == nil {
		t.Fatalf("reload key: %v", err)
	}
	return key
}
