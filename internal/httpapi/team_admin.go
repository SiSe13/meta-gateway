package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/lan/meta-gateway/internal/domain"
)

// replaceUserPolicyGroups 原子替换用户关联的授权分组，并同步保留旧版单组字段。
func replaceUserPolicyGroups(tx *sql.Tx, userID int64, ids []int64) error {
	if len(ids) == 0 {
		return errors.New("empty authorization groups")
	}
	if _, err := tx.Exec(`DELETE FROM team_user_policies WHERE user_id=?`, userID); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.Exec(`INSERT INTO team_user_policies(user_id,policy_id) VALUES(?,?)`, userID, id); err != nil {
			return err
		}
	}
	_, err := tx.Exec(`UPDATE team_users SET policy_id=? WHERE id=?`, ids[0], userID)
	return err
}

// validatePolicyIDs 保证每个用户至少有一个有效授权分组，并去除重复项。
func (h *TeamHandler) validatePolicyIDs(ids []int64) ([]int64, error) {
	seen := make(map[int64]bool, len(ids))
	valid := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, errors.New("invalid authorization group")
		}
		if seen[id] {
			continue
		}
		if _, err := h.policy(id); err != nil {
			return nil, err
		}
		seen[id] = true
		valid = append(valid, id)
	}
	if len(valid) == 0 {
		return nil, errors.New("authorization group required")
	}
	return valid, nil
}

// liveMemberIDs keeps the grants that still resolve to a route member, in the
// operator's order, dropping duplicates and non-positive ids.
//
// A grant whose member was deleted (route removed, channel unbound, group
// deleted, GC swept an orphan) authorizes nothing: there is no member left to
// reach. Keeping it also made the policy unsavable — savePolicy required every
// stored id to still exist, so the console re-submitting an untouched policy
// failed with invalid_members and had no way to point at the culprit, because
// the ghost id has no checkbox in the candidate list. Pruning is lossless.
func (h *TeamHandler) liveMemberIDs(ids []int64) ([]int64, error) {
	live := []int64{}
	if len(ids) == 0 {
		return live, nil
	}
	rows, err := h.db.Query(`SELECT id FROM route_members`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	exists := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		exists[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] || !exists[id] {
			continue
		}
		seen[id] = true
		live = append(live, id)
	}
	return live, nil
}
func (h *TeamHandler) policy(id int64) (TeamPolicy, error) {
	var p TeamPolicy
	var models, members string
	err := h.db.QueryRow(`SELECT id,name,models_json,members_json,all_models,
		(SELECT count(*) FROM team_user_policies WHERE policy_id=team_policies.id) FROM team_policies WHERE id=?`, id).
		Scan(&p.ID, &p.Name, &models, &members, &p.AllModels, &p.UserCount)
	if err == nil {
		err = json.Unmarshal([]byte(models), &p.Models)
	}
	if err == nil {
		err = json.Unmarshal([]byte(members), &p.MemberIDs)
	}
	// Grants that no longer resolve are invisible in the console anyway; reporting
	// them would make every policy read carry ids the operator cannot see, edit,
	// or save.
	if err == nil {
		p.MemberIDs, err = h.liveMemberIDs(p.MemberIDs)
	}
	if p.Models == nil {
		p.Models = []string{}
	}
	if p.MemberIDs == nil {
		p.MemberIDs = []int64{}
	}
	return p, err
}

// userAccess 合并用户全部授权分组，并附带用户级功能开关。
func (h *TeamHandler) userAccess(userID int64) (*domain.TeamAccess, error) {
	var rpm, allowRouting, allowPreferences int
	a := &domain.TeamAccess{UserID: userID, MemberIDs: make(map[int64]bool)}
	if err := h.db.QueryRow(`SELECT rpm,allow_routing,allow_request_preferences FROM team_users WHERE id=?`, userID).
		Scan(&rpm, &allowRouting, &allowPreferences); err != nil {
		return nil, err
	}
	a.RPM, a.AllowRouting, a.AllowRequestPreferences = rpm, allowRouting != 0, allowPreferences != 0
	rows, err := h.db.Query(`SELECT p.models_json,p.members_json,p.all_models FROM team_policies p
		JOIN team_user_policies up ON up.policy_id=p.id WHERE up.user_id=? ORDER BY p.id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var modelsJSON, membersJSON string
		var all int
		var models []string
		var members []int64
		if err := rows.Scan(&modelsJSON, &membersJSON, &all); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(modelsJSON), &models) != nil || json.Unmarshal([]byte(membersJSON), &members) != nil {
			return nil, errors.New("invalid team policy")
		}
		a.Models = append(a.Models, models...)
		a.AllModels = a.AllModels || all != 0
		for _, id := range members {
			a.MemberIDs[id] = true
		}
	}
	return a, rows.Err()
}
func (h *TeamHandler) listPolicies(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id FROM team_policies ORDER BY id`)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if rows.Scan(&id) != nil {
			rows.Close()
			teamFail(w, 500, "load_failed")
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	items := []TeamPolicy{}
	for _, id := range ids {
		p, err := h.policy(id)
		if err != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, p)
	}
	teamJSON(w, 200, items)
}
func (h *TeamHandler) savePolicy(w http.ResponseWriter, r *http.Request) {
	if !teamOwner(w, r) {
		return
	}
	var p TeamPolicy
	if !teamRead(w, r, &p) {
		return
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" || len(p.Name) > 80 || len(p.Models) > 500 || len(p.MemberIDs) > 1000 {
		teamFail(w, 400, "invalid_policy")
		return
	}
	for _, m := range p.Models {
		if strings.TrimSpace(m) == "" || len(m) > 256 {
			teamFail(w, 400, "invalid_policy")
			return
		}
	}
	members, err := h.liveMemberIDs(p.MemberIDs)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	p.MemberIDs = members
	if p.Models == nil {
		p.Models = []string{}
	}
	if p.MemberIDs == nil {
		p.MemberIDs = []int64{}
	}
	models, _ := json.Marshal(p.Models)
	granted, _ := json.Marshal(p.MemberIDs)
	id := int64(0)
	if raw := chiParam(r, "id"); raw != "" {
		id, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			teamFail(w, 400, "invalid_id")
			return
		}
		res, e := h.db.Exec(`UPDATE team_policies SET name=?,models_json=?,members_json=?,all_models=? WHERE id=?`, p.Name, string(models), string(granted), p.AllModels, id)
		err = e
		if e == nil {
			n, _ := res.RowsAffected()
			if n != 1 {
				teamFail(w, 404, "not_found")
				return
			}
		}
	} else {
		res, e := h.db.Exec(`INSERT INTO team_policies(name,models_json,members_json,all_models) VALUES(?,?,?,?)`, p.Name, string(models), string(granted), p.AllModels)
		err = e
		if e == nil {
			id, _ = res.LastInsertId()
		}
	}
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	h.audit(r, "team.policy.update", id)
	p.ID = id
	teamJSON(w, 200, p)
}
func (h *TeamHandler) deletePolicy(w http.ResponseWriter, r *http.Request) {
	if !teamOwner(w, r) {
		return
	}
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	res, err := h.db.Exec(`DELETE FROM team_policies WHERE id=? AND id<>1 AND NOT EXISTS(SELECT 1 FROM team_user_policies WHERE policy_id=?) AND NOT EXISTS(SELECT 1 FROM team_invites WHERE policy_id=?)`, id, id, id)
	if err != nil {
		teamFail(w, 409, "policy_in_use")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		teamFail(w, 409, "policy_in_use")
		return
	}
	h.audit(r, "team.policy.delete", id)
	teamJSON(w, 200, map[string]bool{"ok": true})
}

func (h *TeamHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	query := teamUserSelect
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" {
		query += ` WHERE u.role='member'`
	}
	rows, err := h.db.Query(query + ` ORDER BY u.id DESC LIMIT 1000`)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	defer rows.Close()
	items := []*TeamUser{}
	for rows.Next() {
		u, e := scanTeamUser(rows)
		if e != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, u)
	}
	teamJSON(w, 200, items)
}
func (h *TeamHandler) managedUser(w http.ResponseWriter, r *http.Request) (*TeamUser, bool) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return nil, false
	}
	u, err := h.user(id)
	if err != nil {
		teamFail(w, 404, "not_found")
		return nil, false
	}
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" && u.Role != "member" {
		teamFail(w, 403, "owner_required")
		return nil, false
	}
	return u, true
}
func (h *TeamHandler) updateUser(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managedUser(w, r)
	if !ok {
		return
	}
	var req struct {
		Name     *string `json:"name"`
		Status   *string `json:"status"`
		PolicyID *int64   `json:"policy_id"`
		PolicyIDs *[]int64 `json:"policy_ids"`
		MaxKeys   *int    `json:"max_keys"`
		RPM       *int    `json:"rpm"`
		AllowRouting *bool `json:"allow_routing"`
		AllowRequestPreferences *bool `json:"allow_request_preferences"`
		Role     *string `json:"role"`
		// The account credit pool. quota_reset zeroes the spend counters in the
		// same write, which is what "top this person up" means in practice.
		QuotaTotal *int64   `json:"quota_total_tokens"`
		QuotaCost  *float64 `json:"quota_total_cost"`
		QuotaReset bool     `json:"quota_reset"`
	}
	if !teamRead(w, r, &req) {
		return
	}
	if req.QuotaTotal != nil {
		if *req.QuotaTotal < 0 || *req.QuotaTotal > teamQuotaMaxTokens {
			teamFail(w, 400, "invalid_quota")
			return
		}
		u.QuotaTotalTokens = *req.QuotaTotal
	}
	if req.QuotaCost != nil {
		if *req.QuotaCost < 0 || *req.QuotaCost > teamQuotaMaxCost {
			teamFail(w, 400, "invalid_quota")
			return
		}
		u.QuotaTotalCost = *req.QuotaCost
	}
	resetUsed := false
	if req.QuotaReset {
		u.QuotaUsedTokens = 0
		u.QuotaUsedCost = 0
		resetUsed = true
	}
	if req.Role != nil && !teamOwner(w, r) {
		return
	}
	if req.Name != nil {
		u.Name = strings.TrimSpace(*req.Name)
		if u.Name == "" || len(u.Name) > 80 {
			teamFail(w, 400, "invalid_request")
			return
		}
	}
	if req.Status != nil {
		if *req.Status != "active" && *req.Status != "paused" {
			teamFail(w, 400, "invalid_request")
			return
		}
		if u.Role == "owner" && *req.Status != "active" {
			teamFail(w, 409, "owner_protected")
			return
		}
		u.Status = *req.Status
	}
	if req.Role != nil {
		if u.Role == "owner" || (*req.Role != "member" && *req.Role != "admin") {
			teamFail(w, 409, "owner_protected")
			return
		}
		u.Role = *req.Role
	}
	var policyIDs []int64
	groupsChanged := false
	if req.PolicyIDs != nil {
		var err error
		policyIDs, err = h.validatePolicyIDs(*req.PolicyIDs)
		if err != nil {
			teamFail(w, 400, "invalid_policy")
			return
		}
		groupsChanged = true
	} else if req.PolicyID != nil {
		var err error
		policyIDs, err = h.validatePolicyIDs([]int64{*req.PolicyID})
		if err != nil {
			teamFail(w, 400, "invalid_policy")
			return
		}
		groupsChanged = true
	}
	if req.MaxKeys != nil {
		if *req.MaxKeys < 1 || *req.MaxKeys > 100 {
			teamFail(w, 400, "invalid_request")
			return
		}
		u.MaxKeys = *req.MaxKeys
	}
	if req.RPM != nil {
		if *req.RPM < 1 || *req.RPM > 100000 {
			teamFail(w, 400, "invalid_request")
			return
		}
		u.RPM = *req.RPM
	}
	if req.AllowRouting != nil {
		u.AllowRouting = *req.AllowRouting
	}
	if req.AllowRequestPreferences != nil {
		u.AllowRequestPreferences = *req.AllowRequestPreferences
	}
	if groupsChanged {
		u.PolicyIDs = policyIDs
		u.PolicyID = policyIDs[0]
	}
	if (groupsChanged || req.MaxKeys != nil || req.RPM != nil || req.AllowRouting != nil || req.AllowRequestPreferences != nil) && !teamOwner(w, r) {
		return
	}
	// A quota reset rides along with the rest of the update, so "raise the cap
	// and start counting again" is one atomic write rather than two.
	tx, err := h.db.Begin()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	defer tx.Rollback()
	set := `name=?,status=?,role=?,policy_id=?,max_keys=?,rpm=?,allow_routing=?,allow_request_preferences=?,quota_total_tokens=?,quota_total_cost=?,session_version=session_version+1`
	args := []any{u.Name, u.Status, u.Role, u.PolicyID, u.MaxKeys, u.RPM, u.AllowRouting, u.AllowRequestPreferences, u.QuotaTotalTokens, u.QuotaTotalCost}
	if resetUsed {
		set += `,quota_used_tokens=0,quota_used_cost=0`
	}
	_, err = tx.Exec(`UPDATE team_users SET `+set+` WHERE id=?`, append(args, u.ID)...)
	if err == nil && groupsChanged {
		err = replaceUserPolicyGroups(tx, u.ID, policyIDs)
	}
	if err == nil {
		_, err = tx.Exec(`DELETE FROM team_sessions WHERE user_id=?`, u.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	h.audit(r, "team.user.update", u.ID)
	teamJSON(w, 200, u)
}
func (h *TeamHandler) revokeUserSessions(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managedUser(w, r)
	if !ok {
		return
	}
	if u.Role == "owner" {
		teamFail(w, 409, "owner_protected")
		return
	}
	_, err := h.db.Exec(`DELETE FROM team_sessions WHERE user_id=?`, u.ID)
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	h.audit(r, "team.sessions.revoke", u.ID)
	teamJSON(w, 200, map[string]bool{"ok": true})
}
func (h *TeamHandler) userEvents(w http.ResponseWriter, r *http.Request) {
	u, ok := h.managedUser(w, r)
	if !ok {
		return
	}
	rows, err := h.db.Query(`SELECT action,created_at,COALESCE(actor_id,0) FROM audit_events WHERE resource_kind='team' AND resource_id=? AND action LIKE 'team.user.%' ORDER BY id DESC LIMIT 50`, u.ID)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var action, created string
		var actor int64
		if rows.Scan(&action, &created, &actor) != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, map[string]any{"action": action, "created_at": created, "actor_id": actor})
	}
	teamJSON(w, 200, items)
}

type teamInviteView struct {
	ID        int64  `json:"id"`
	Label     string `json:"label"`
	PolicyID  int64  `json:"policy_id"`
	Role      string `json:"role"`
	ExpiresAt int64  `json:"expires_at"`
	Consumed  bool   `json:"consumed"`
	Revoked   bool   `json:"revoked"`
}

func (h *TeamHandler) listInvites(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id,label,policy_id,role,expires_at,consumed_at IS NOT NULL,revoked FROM team_invites WHERE kind='invite' ORDER BY id DESC LIMIT 200`)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	defer rows.Close()
	items := []teamInviteView{}
	for rows.Next() {
		var v teamInviteView
		if rows.Scan(&v.ID, &v.Label, &v.PolicyID, &v.Role, &v.ExpiresAt, &v.Consumed, &v.Revoked) != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, v)
	}
	teamJSON(w, 200, items)
}
func (h *TeamHandler) createInvite(w http.ResponseWriter, r *http.Request) {
	if !h.enabled() {
		teamFail(w, 409, "team_disabled")
		return
	}
	var req struct {
		Label    string `json:"label"`
		PolicyID int64  `json:"policy_id"`
		Role     string `json:"role"`
	}
	if !teamRead(w, r, &req) {
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role == "admin" && !teamOwner(w, r) {
		return
	}
	if (req.Role != "member" && req.Role != "admin") || len(req.Label) > 80 {
		teamFail(w, 400, "invalid_request")
		return
	}
	if _, err := h.policy(req.PolicyID); err != nil {
		teamFail(w, 400, "invalid_policy")
		return
	}
	raw, err := teamRandom()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	expiry := time.Now().Add(7 * 24 * time.Hour).Unix()
	res, err := h.db.Exec(`INSERT INTO team_invites(token_hash,label,policy_id,role,expires_at) VALUES(?,?,?,?,?)`, teamHash(raw), req.Label, req.PolicyID, req.Role, expiry)
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	id, _ := res.LastInsertId()
	h.audit(r, "team.invite.create", id)
	teamJSON(w, 201, map[string]any{"id": id, "path": "/app/accept#invite=" + raw, "expires_at": expiry})
}
func (h *TeamHandler) revokeInvite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	query := `UPDATE team_invites SET revoked=1 WHERE id=?`
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" {
		query += ` AND role='member' AND kind='invite'`
	}
	res, err := h.db.Exec(query, id)
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		teamFail(w, 404, "not_found")
		return
	}
	teamJSON(w, 200, map[string]bool{"ok": true})
}
func (h *TeamHandler) createRecovery(w http.ResponseWriter, r *http.Request) {
	if !teamOwner(w, r) {
		return
	}
	u, ok := h.managedUser(w, r)
	if !ok {
		return
	}
	raw, err := teamRandom()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	tx, err := h.db.Begin()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE team_invites SET revoked=1 WHERE user_id=? AND kind='recovery'`, u.ID)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO team_invites(token_hash,label,policy_id,kind,user_id,expires_at) VALUES(?,?,?,'recovery',?,?)`, teamHash(raw), u.Name, u.PolicyID, u.ID, time.Now().Add(time.Hour).Unix())
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	h.audit(r, "team.user.recovery", u.ID)
	teamJSON(w, 201, map[string]string{"path": "/app/recover#recovery=" + raw})
}
