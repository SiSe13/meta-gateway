package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Member management: creating accounts directly, importing a pasted list, and
// acting on a selection. Invitations stay the self-service path; these are the
// paths an operator takes when they already know who they are onboarding.

const (
	teamUserNameMax    = 80
	teamBulkMaxIDs     = 500
	teamImportMaxLines = 500
	teamImportMaxBytes = 64 << 10
	teamQuotaMaxTokens = 1_000_000_000_000
	// The money budget's ceiling, in the ledger's unit.
	teamQuotaMaxCost = 1_000_000.0
)

var errTeamConcurrencyLimit = errors.New("team concurrency limit exceeded")

// grantUserConcurrency 原子增加并发额度，并保存这次授予的回收时间。
func grantUserConcurrency(tx *sql.Tx, userID int64, amount int, expiresAt int64) error {
	var updated int
	err := tx.QueryRow(`UPDATE team_users SET max_concurrent=max_concurrent+?
		WHERE id=? AND max_concurrent<=? RETURNING max_concurrent`, amount, userID, teamCodeMaxConcurrent-amount).Scan(&updated)
	if errors.Is(err, sql.ErrNoRows) {
		return errTeamConcurrencyLimit
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO team_concurrency_grants(user_id,quota_concurrent,grant_expires_at)
		VALUES(?,?,?)`, userID, amount, expiresAt)
	return err
}

// createUserRequest is shared by the single-create and import paths so both
// refuse the same shapes for the same reasons.
type createUserRequest struct {
	Username  string  `json:"username"`
	Name      string  `json:"name"`
	Password  string  `json:"password"`
	PolicyID  int64   `json:"policy_id"`
	PolicyIDs []int64 `json:"policy_ids"`
	Role      string  `json:"role"`
	Quota     int64   `json:"quota_tokens"`
	// QuotaCost is the same allowance in money (0 = unlimited). Both budgets are
	// enforced, so a member may be capped by either.
	QuotaCost float64 `json:"quota_cost"`
	// Generated carries a password the server invented, so the console can show
	// it once. Empty when the operator supplied one.
	Generated string `json:"-"`
}

// validateCreate normalizes one account and returns its password hash, or the
// message key to answer with.
func (h *TeamHandler) validateCreate(req *createUserRequest, actorOwner bool) (string, string) {
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		req.Name = req.Username
	}
	if h.operatorNameReserved(req.Username) {
		return "", "username_taken"
	}
	if !teamUsername.MatchString(req.Username) {
		return "", "invalid_username"
	}
	if len(req.Name) > teamUserNameMax {
		return "", "invalid_request"
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role != "member" && req.Role != "admin" {
		return "", "invalid_request"
	}
	if req.Role == "admin" && !actorOwner {
		return "", "owner_required"
	}
	if req.Quota < 0 || req.Quota > teamQuotaMaxTokens {
		return "", "invalid_quota"
	}
	if req.QuotaCost < 0 || req.QuotaCost > teamQuotaMaxCost {
		return "", "invalid_quota"
	}
	if strings.TrimSpace(req.Password) == "" {
		// There is no mail server behind this gateway, so an omitted password
		// becomes a generated one the operator hands over themselves.
		generated, err := teamCode()
		if err != nil {
			return "", "save_failed"
		}
		req.Password = strings.ReplaceAll(generated, "-", "")
		req.Generated = req.Password
	}
	hash, err := hashTeamPassword(req.Password)
	if err != nil {
		return "", "password_length"
	}
	return hash, ""
}

// insertUser writes the account row and reports whether the username was taken.
func (h *TeamHandler) insertUser(req createUserRequest, hash string) (int64, bool, error) {
	ids := req.PolicyIDs
	if len(ids) == 0 {
		ids = []int64{req.PolicyID}
	}
	tx, err := h.db.Begin()
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO team_users(username,name,password_hash,role,policy_id,quota_total_tokens,quota_total_cost) VALUES(?,?,?,?,?,?,?)`,
		req.Username, req.Name, hash, req.Role, ids[0], req.Quota, req.QuotaCost)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return 0, true, nil
		}
		return 0, false, err
	}
	id, err := res.LastInsertId()
	if err == nil {
		err = replaceUserPolicyGroups(tx, id, ids)
	}
	if err == nil {
		err = tx.Commit()
	}
	return id, false, err
}

// createUser is the console's "New member": an account that exists
// immediately, with no invitation round-trip.
func (h *TeamHandler) createUser(w http.ResponseWriter, r *http.Request) {
	if !h.enabled() {
		teamFail(w, 409, "team_disabled")
		return
	}
	var req createUserRequest
	if !teamRead(w, r, &req) {
		return
	}
	owner, _ := teamOwnerValue(r)
	hash, fail := h.validateCreate(&req, owner)
	if fail != "" {
		h.failCreate(w, fail)
		return
	}
	if len(req.PolicyIDs) == 0 && req.PolicyID > 0 {
		req.PolicyIDs = []int64{req.PolicyID}
	}
	var err error
	req.PolicyIDs, err = h.validatePolicyIDs(req.PolicyIDs)
	if err != nil {
		teamFail(w, 400, "invalid_policy")
		return
	}
	req.PolicyID = req.PolicyIDs[0]
	id, taken, err := h.insertUser(req, hash)
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	if taken {
		teamFail(w, 409, "username_taken")
		return
	}
	h.audit(r, "team.user.create", id)
	u, err := h.user(id)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	teamJSON(w, 201, map[string]any{"user": u, "password": req.Generated})
}

// failCreate maps a validation key onto the right status: a bad password is a
// 400, a role escalation is a 403.
func (h *TeamHandler) failCreate(w http.ResponseWriter, key string) {
	if key == "owner_required" {
		teamFail(w, 403, key)
		return
	}
	teamFail(w, 400, key)
}

// importUsers creates accounts from a pasted list: one per line,
// `username, name, password[, quota]`. Blank lines and `#` comments are
// skipped, so a spreadsheet dump can be pasted as-is. Failures are reported per
// line rather than aborting the batch — one bad row out of fifty must not cost
// the other forty-nine.
func (h *TeamHandler) importUsers(w http.ResponseWriter, r *http.Request) {
	if !h.enabled() {
		teamFail(w, 409, "team_disabled")
		return
	}
	var req struct {
		Text      string  `json:"text"`
		PolicyID  int64   `json:"policy_id"`
		PolicyIDs []int64 `json:"policy_ids"`
		Quota     int64   `json:"quota_tokens"`
		QuotaCost float64 `json:"quota_cost"`
	}
	if !teamRead(w, r, &req) {
		return
	}
	if len(req.Text) > teamImportMaxBytes {
		teamFail(w, 400, "import_too_large")
		return
	}
	if req.Quota < 0 || req.Quota > teamQuotaMaxTokens {
		teamFail(w, 400, "invalid_quota")
		return
	}
	if req.QuotaCost < 0 || req.QuotaCost > teamQuotaMaxCost {
		teamFail(w, 400, "invalid_quota")
		return
	}
	if len(req.PolicyIDs) == 0 && req.PolicyID > 0 {
		req.PolicyIDs = []int64{req.PolicyID}
	}
	var policyErr error
	req.PolicyIDs, policyErr = h.validatePolicyIDs(req.PolicyIDs)
	if policyErr != nil {
		teamFail(w, 400, "invalid_policy")
		return
	}
	owner, _ := teamOwnerValue(r)
	type failedRow struct {
		Line   int    `json:"line"`
		Input  string `json:"input"`
		Reason string `json:"reason"`
	}
	type createdRow struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	out := struct {
		Created []createdRow `json:"created"`
		Failed  []failedRow  `json:"failed"`
	}{Created: []createdRow{}, Failed: []failedRow{}}

	for index, raw := range strings.Split(strings.ReplaceAll(req.Text, "\r\n", "\n"), "\n") {
		if len(out.Created) >= teamImportMaxLines {
			break
		}
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, ",")
		for i := range fields {
			fields[i] = strings.TrimSpace(fields[i])
		}
		item := createUserRequest{PolicyID: req.PolicyIDs[0], PolicyIDs: req.PolicyIDs, Role: "member", Quota: req.Quota, QuotaCost: req.QuotaCost}
		item.Username = fields[0]
		if len(fields) > 1 {
			item.Name = fields[1]
		}
		if len(fields) > 2 {
			item.Password = fields[2]
		}
		if len(fields) > 3 && fields[3] != "" {
			quota, err := parseTokenAmount(fields[3])
			if err != nil {
				out.Failed = append(out.Failed, failedRow{Line: index + 1, Input: line, Reason: "invalid_quota"})
				continue
			}
			item.Quota = quota
		}
		// A fifth column names the money budget, so one pasted list can carry
		// both kinds of allowance.
		if len(fields) > 4 && fields[4] != "" {
			cost, err := parseCostAmount(fields[4])
			if err != nil {
				out.Failed = append(out.Failed, failedRow{Line: index + 1, Input: line, Reason: "invalid_quota"})
				continue
			}
			item.QuotaCost = cost
		}
		hash, fail := h.validateCreate(&item, owner)
		if fail == "" {
			id, taken, err := h.insertUser(item, hash)
			switch {
			case err != nil:
				fail = "save_failed"
			case taken:
				fail = "username_taken"
			default:
				h.audit(r, "team.user.create", id)
				// 导入结果只返回给当前管理员，用于一次性核对并交付本次提交的凭据。
				out.Created = append(out.Created, createdRow{ID: id, Username: item.Username, Name: item.Name, Password: item.Password})
				continue
			}
		}
		out.Failed = append(out.Failed, failedRow{Line: index + 1, Input: line, Reason: fail})
	}
	teamJSON(w, 200, out)
}

// parseCostAmount accepts the money budget in the ledger's unit, with the same
// k/m shorthand the token parser offers ("1.5k" = 1500).
func parseCostAmount(raw string) (float64, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	multiplier := 1.0
	switch {
	case strings.HasSuffix(value, "k"):
		multiplier, value = 1_000, strings.TrimSuffix(value, "k")
	case strings.HasSuffix(value, "m"):
		multiplier, value = 1_000_000, strings.TrimSuffix(value, "m")
	}
	whole, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || whole < 0 || whole*multiplier > teamQuotaMaxCost {
		return 0, errors.New("invalid amount")
	}
	return whole * multiplier, nil
}

// parseTokenAmount accepts plain digits or a 12k / 1.5m shorthand, because an
// operator typing quotas by hand writes "500k", not "500000".
func parseTokenAmount(raw string) (int64, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	multiplier := int64(1)
	switch {
	case strings.HasSuffix(value, "k"):
		multiplier, value = 1_000, strings.TrimSuffix(value, "k")
	case strings.HasSuffix(value, "m"):
		multiplier, value = 1_000_000, strings.TrimSuffix(value, "m")
	}
	whole, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || whole < 0 {
		return 0, errors.New("invalid amount")
	}
	total := whole * multiplier
	if total < 0 || total > teamQuotaMaxTokens {
		return 0, errors.New("amount out of range")
	}
	return total, nil
}

// bulkUsers applies one action to a selection of members. Deleting is the
// destructive one and is deliberately precise about what it removes.
func (h *TeamHandler) bulkUsers(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs               []int64  `json:"ids"`
		Action            string   `json:"action"`
		PolicyID          int64    `json:"policy_id"`
		PolicyIDs         []int64  `json:"policy_ids"`
		QuotaTotalTokens  *int64   `json:"quota_total_tokens"`
		QuotaTotalCost    *float64 `json:"quota_total_cost"`
		QuotaReset        bool     `json:"quota_reset"`
		Concurrency       int      `json:"concurrency"`
		GrantValidityDays int      `json:"grant_validity_days"`
	}
	if !teamRead(w, r, &req) {
		return
	}
	ids, ok := parseMemberIDs(req.IDs)
	if !ok {
		teamFail(w, 400, "invalid_ids")
		return
	}
	owner, _ := teamOwnerValue(r)
	actorID := int64(0)
	if p := teamActor(r); p != nil && p.User != nil {
		actorID = p.User.ID
	}
	// Every action is one statement, and every statement excludes the owner:
	// a stale console selection must never be able to lock the owner out, and a
	// restricted admin may only ever touch members.
	scope := ` AND role <> 'owner'`
	if !owner {
		scope += ` AND role = 'member'`
	}
	affected := func(query string, args []any) (int64, error) {
		res, err := h.db.Exec(query, args...)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		return n, nil
	}
	args := int64sToAny(ids)
	inList := placeholders(len(ids))

	switch req.Action {
	case "pause", "resume":
		status := "paused"
		if req.Action == "resume" {
			status = "active"
		}
		// Bumping session_version is what actually ends live sessions; the
		// delete below is belt and braces for rows created before this existed.
		n, err := affected(`UPDATE team_users SET status=?,session_version=session_version+1 WHERE id IN (`+inList+`)`+scope, append([]any{status}, args...))
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		if _, err := h.db.Exec(`DELETE FROM team_sessions WHERE user_id IN (`+inList+`) AND user_id IN (SELECT id FROM team_users WHERE role <> 'owner'`+ownerGuard(owner)+`)`, args...); err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		h.audit(r, "team.users."+req.Action, actorID)
		teamJSON(w, 200, map[string]any{"updated": n})
	case "policy":
		if len(req.PolicyIDs) == 0 && req.PolicyID > 0 {
			req.PolicyIDs = []int64{req.PolicyID}
		}
		policyIDs, err := h.validatePolicyIDs(req.PolicyIDs)
		if err != nil {
			teamFail(w, 400, "invalid_policy")
			return
		}
		tx, err := h.db.Begin()
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		defer tx.Rollback()
		rows, err := tx.Query(`SELECT id FROM team_users WHERE id IN (`+inList+`)`+scope, args...)
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		eligible := []int64{}
		for rows.Next() {
			var userID int64
			if err = rows.Scan(&userID); err != nil {
				break
			}
			eligible = append(eligible, userID)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		for _, userID := range eligible {
			if err = replaceUserPolicyGroups(tx, userID, policyIDs); err != nil {
				break
			}
		}
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		n := int64(len(eligible))
		h.audit(r, "team.users.policy", actorID)
		teamJSON(w, 200, map[string]any{"updated": n})
	case "quota":
		if !owner {
			teamFail(w, 403, "owner_required")
			return
		}
		if req.QuotaTotalTokens == nil || req.QuotaTotalCost == nil ||
			*req.QuotaTotalTokens < 0 || *req.QuotaTotalTokens > teamQuotaMaxTokens ||
			*req.QuotaTotalCost < 0 || *req.QuotaTotalCost > teamQuotaMaxCost {
			teamFail(w, 400, "invalid_quota")
			return
		}
		// 批量额度在单个事务中统一写入，避免部分成员成功、部分成员失败。
		tx, err := h.db.Begin()
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		defer tx.Rollback()
		set := `UPDATE team_users SET quota_total_tokens=?,quota_total_cost=?`
		if req.QuotaReset {
			set += `,quota_used_tokens=0,quota_used_cost=0`
		}
		result, err := tx.Exec(set+` WHERE id IN (`+inList+`)`+scope,
			append([]any{*req.QuotaTotalTokens, *req.QuotaTotalCost}, args...)...)
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		updated, _ := result.RowsAffected()
		h.audit(r, "team.users.quota", actorID)
		teamJSON(w, 200, map[string]any{"updated": updated})
	case "concurrency":
		if !owner {
			teamFail(w, 403, "owner_required")
			return
		}
		if req.Concurrency < 1 || req.Concurrency > teamCodeMaxConcurrent || req.GrantValidityDays < 0 || req.GrantValidityDays > teamCodeMaxGrantValidityDays {
			teamFail(w, 400, "invalid_request")
			return
		}
		tx, err := h.db.Begin()
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		defer tx.Rollback()
		rows, err := tx.Query(`SELECT id FROM team_users WHERE id IN (`+inList+`)`+scope, args...)
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		eligible := []int64{}
		for rows.Next() {
			var userID int64
			if err = rows.Scan(&userID); err != nil {
				break
			}
			eligible = append(eligible, userID)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		expiresAt := int64(0)
		if req.GrantValidityDays > 0 {
			expiresAt = time.Now().Add(time.Duration(req.GrantValidityDays) * 24 * time.Hour).Unix()
		}
		for _, userID := range eligible {
			if err = grantUserConcurrency(tx, userID, req.Concurrency, expiresAt); err != nil {
				if errors.Is(err, errTeamConcurrencyLimit) {
					teamFail(w, 400, "concurrency_limit_exceeded")
				} else {
					teamFail(w, 500, "save_failed")
				}
				return
			}
		}
		if err = tx.Commit(); err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		h.audit(r, "team.users.concurrency", actorID)
		teamJSON(w, 200, map[string]any{"updated": len(eligible)})
	case "revoke_sessions":
		res, err := h.db.Exec(`DELETE FROM team_sessions WHERE user_id IN (`+inList+`) AND user_id IN (SELECT id FROM team_users WHERE role <> 'owner'`+ownerGuard(owner)+`)`, args...)
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		n, _ := res.RowsAffected()
		h.audit(r, "team.sessions.revoke", actorID)
		teamJSON(w, 200, map[string]any{"sessions": n})
	case "delete":
		if !owner {
			teamFail(w, 403, "owner_required")
			return
		}
		deleted, err := h.deleteUsers(ids)
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		h.audit(r, "team.users.delete", actorID)
		teamJSON(w, 200, map[string]any{"deleted": deleted})
	default:
		teamFail(w, 400, "invalid_action")
	}
}

// ownerGuard narrows a subquery to members when the caller is not the owner.
func ownerGuard(owner bool) string {
	if owner {
		return ""
	}
	return ` AND role='member'`
}

// deleteUsers removes accounts for good. Their keys are neutralized first: a
// key row that outlives its account would keep authenticating at the relay,
// which is the one failure mode this action must never have.
//
// Every table that references team_users has to let go of the account before the
// row itself goes: those foreign keys carry no ON DELETE rule, so one surviving
// reference fails the delete (the fully revoked key row was exactly that). Keys
// and invitations keep their rows for history and lose the owner; identities and
// code redemptions belong to the account alone and go with it.
func (h *TeamHandler) deleteUsers(ids []int64) (int64, error) {
	tx, err := h.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	args := int64sToAny(ids)
	list := placeholders(len(ids))
	if _, err := tx.Exec(`UPDATE downstream_keys SET enabled=0,token_enc='',token_hash='revoked-user-key-'||id,team_deleted_at=datetime('now'),user_id=NULL
		WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM team_sessions WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM team_route_plans WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM team_code_redemptions WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM team_identities WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM team_invites WHERE kind='recovery' AND user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	// Invitations of other kinds may name the account (a credit code handed to
	// one person): they stay usable but must stop pointing at a row that is gone.
	if _, err := tx.Exec(`UPDATE team_invites SET user_id=NULL WHERE user_id IN (`+list+`)`, args...); err != nil {
		return 0, err
	}
	res, err := tx.Exec(`DELETE FROM team_users WHERE id IN (`+list+`) AND role <> 'owner'`, args...)
	if err != nil {
		return 0, err
	}
	deleted, _ := res.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return deleted, nil
}

// parseMemberIDs normalizes a selection: duplicates collapse, unusable ids are
// dropped, and an empty result is refused so a bulk action cannot degenerate
// into "act on everything".
func parseMemberIDs(raw []int64) ([]int64, bool) {
	if len(raw) == 0 || len(raw) > teamBulkMaxIDs {
		return nil, false
	}
	seen := make(map[int64]bool, len(raw))
	out := make([]int64, 0, len(raw))
	for _, id := range raw {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, len(out) > 0
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func int64sToAny(ids []int64) []any {
	out := make([]any, 0, len(ids))
	for _, id := range ids {
		out = append(out, id)
	}
	return out
}

// teamOwnerValue reports whether the caller acts with owner authority, without
// writing a response of its own (teamOwner does that, and is for owner-only
// actions).
//
// A request authenticated by the legacy admin token carries no team principal:
// that token IS the operator, so it is treated as the owner. Reading a missing
// principal as "not an owner" is what made bulk delete answer 403 to the
// console's own token.
func teamOwnerValue(r *http.Request) (bool, bool) {
	p := teamActor(r)
	if p == nil || p.User == nil {
		return true, true
	}
	return p.User.Role == "owner", true
}
