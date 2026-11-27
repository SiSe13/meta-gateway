package httpapi

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
)

// Team codes are one table with four jobs, distinguished by kind:
//
//	invite   — sign up (single-use by default, multi-use when max_uses > 1)
//	credit   — top up the signed-in member's own credit pool
//	concurrency — add in-flight request slots to the signed-in member's account
//	recovery — reset a password (bound to one account)
//
// The hash remains the redemption verifier; newly minted codes also keep an
// encrypted copy so an authenticated operator can explicitly reveal them later.

const (
	teamCodeKinds    = "invite,credit,concurrency"
	teamCodeMaxBatch = 500
	teamCodeMaxQuota = 1_000_000_000_000
	// A voucher's money face value, in the ledger's unit.
	teamCodeMaxCost       = 1_000_000.0
	teamCodeMaxUses       = 100000
	teamCodeMaxNote       = 200
	teamCodeMaxConcurrent = 10000
	teamCodeMaxValidity   = 365 * 24 * time.Hour
	// 兑换后的额度与并发最长有效一年；0 表示永久。
	teamCodeMaxGrantValidityDays = 365
)

// teamCodeAlphabet omits the characters that get misread out loud (I, L, O, U)
// and the ones that clash with the display dashes.
const teamCodeAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

// teamCode produces a code an operator can read out loud: 16 Crockford-ish
// base32 characters in four groups (80 bits — not guessable, still typeable).
// Legacy 43-character tokens issued before this existed keep working: lookups
// hash whatever is presented.
func teamCode() (string, error) {
	alphabet := teamCodeAlphabet
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]string, 0, 4)
	for i := 0; i < 16; i += 4 {
		group := make([]byte, 4)
		for j := 0; j < 4; j++ {
			group[j] = alphabet[int(buf[i+j])%len(alphabet)]
		}
		out = append(out, string(group))
	}
	return strings.Join(out, "-"), nil
}

// extractTeamCode accepts what a human might paste: a bare code, or a whole
// accept URL from which only the code is kept.
func extractTeamCode(raw string) string {
	value := strings.TrimSpace(raw)
	if idx := strings.Index(value, "#invite="); idx >= 0 {
		value = value[idx+len("#invite="):]
	}
	if idx := strings.Index(value, "?code="); idx >= 0 {
		value = value[idx+len("?code="):]
	}
	return strings.TrimSpace(strings.SplitN(value, "&", 2)[0])
}

// stripTeamCode keeps only the significant characters of a short code. Its
// dashes are display grouping, not data: an operator reading a code off a chat
// message may paste it with spaces, without the dashes, or in lower case, and
// all three spell the same voucher.
func stripTeamCode(raw string) string {
	var out strings.Builder
	for _, char := range strings.ToUpper(extractTeamCode(raw)) {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			out.WriteRune(char)
		}
	}
	return out.String()
}

// isShortTeamCode reports whether the value has the shape teamCode() produces
// (16 characters from its alphabet, optionally grouped). Codes issued before
// this format are 43-character base64url tokens and stay case-sensitive, so
// only values that really look like short codes get the relaxed matching.
func isShortTeamCode(raw string) bool {
	stripped := stripTeamCode(raw)
	if len(stripped) != 16 {
		return false
	}
	for _, char := range stripped {
		if !strings.ContainsRune(teamCodeAlphabet, char) {
			return false
		}
	}
	return true
}

// teamCodeCandidates returns the hashes to try for a presented code. A short
// code is stored in its stripped spelling (see createCodes), which is what a
// hand-typed value normalizes to; anything else — a code issued before the
// short format, a pasted accept URL — is hashed exactly as presented.
func teamCodeCandidates(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	out := []string{}
	if isShortTeamCode(trimmed) {
		out = append(out, teamHash(stripTeamCode(trimmed)))
	}
	return append(out, teamHash(trimmed))
}

type teamCodeView struct {
	ID                int64   `json:"id"`
	Kind              string  `json:"kind"`
	Label             string  `json:"label"`
	Note              string  `json:"note"`
	PolicyID          int64   `json:"policy_id"`
	Role              string  `json:"role"`
	ExpiresAt         int64   `json:"expires_at"`
	MaxUses           int     `json:"max_uses"`
	UsedCount         int     `json:"used_count"`
	QuotaToken        int64   `json:"quota_tokens"`
	QuotaCost         float64 `json:"quota_cost"`
	QuotaConcurrent   int     `json:"quota_concurrent"`
	GrantValidityDays int     `json:"grant_validity_days"`
	Revoked           bool    `json:"revoked"`
	CreatedAt         string  `json:"created_at"`
	// Prefix is a display hint only (first group), so an operator can tell two
	// vouchers apart without the table storing anything recoverable.
	Prefix string `json:"prefix"`
	// Revealable 只表示存在受保护的密文，不包含密文或明文。
	Revealable bool `json:"revealable"`
}

func (h *TeamHandler) listCodes(w http.ResponseWriter, r *http.Request) {
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	query := `SELECT id,kind,label,note,policy_id,role,expires_at,max_uses,used_count,quota_tokens,quota_cost,quota_concurrent,grant_validity_days,revoked,created_at,(token_enc <> '') FROM team_invites WHERE kind IN ('invite','credit')`
	args := []any{}
	if kind == "invite" || kind == "credit" {
		query += ` AND kind=?`
		args = append(args, kind)
		if kind == "credit" {
			query += ` AND quota_concurrent=0`
		}
	} else if kind == "concurrency" {
		query += ` AND kind='credit' AND quota_concurrent>0`
	}
	// Recovery links are bound to one account and belong to that account's
	// detail view, not to the code board.
	query += ` ORDER BY id DESC LIMIT 500`
	rows, err := h.db.Query(query, args...)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	defer rows.Close()
	items := []teamCodeView{}
	for rows.Next() {
		var v teamCodeView
		if rows.Scan(&v.ID, &v.Kind, &v.Label, &v.Note, &v.PolicyID, &v.Role, &v.ExpiresAt, &v.MaxUses, &v.UsedCount, &v.QuotaToken, &v.QuotaCost, &v.QuotaConcurrent, &v.GrantValidityDays, &v.Revoked, &v.CreatedAt, &v.Revealable) != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, v)
		if v.QuotaConcurrent > 0 {
			items[len(items)-1].Kind = "concurrency"
		}
	}
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" {
		// A restricted admin manages members, so only member-facing codes are
		// theirs; admin-role invitations stay owner-only.
		filtered := items[:0]
		for _, item := range items {
			if item.Role == "member" {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	teamJSON(w, 200, items)
}

type teamCodeCreate struct {
	Kind              string  `json:"kind"`
	Count             int     `json:"count"`
	Label             string  `json:"label"`
	Note              string  `json:"note"`
	PolicyID          int64   `json:"policy_id"`
	PolicyIDs         []int64 `json:"policy_ids"`
	Role              string  `json:"role"`
	MaxUses           int     `json:"max_uses"`
	QuotaToken        int64   `json:"quota_tokens"`
	QuotaCost         float64 `json:"quota_cost"`
	QuotaConcurrent   int     `json:"quota_concurrent"`
	ExpiresIn         *int64  `json:"expires_in_hours"`
	GrantValidityDays int     `json:"grant_validity_days"`
}

// createCodes mints 1..N codes in one request. Batch generation is the whole
// point: an operator hands out a class of thirty people, not one.
func (h *TeamHandler) createCodes(w http.ResponseWriter, r *http.Request) {
	if !h.enabled() {
		teamFail(w, 409, "team_disabled")
		return
	}
	var req teamCodeCreate
	if !teamRead(w, r, &req) {
		return
	}
	if req.Kind != "invite" && req.Kind != "credit" && req.Kind != "concurrency" {
		teamFail(w, 400, "invalid_kind")
		return
	}
	if req.Count <= 0 {
		req.Count = 1
	}
	if req.Count > teamCodeMaxBatch {
		teamFail(w, 400, "batch_too_large")
		return
	}
	if len(req.Label) > 80 || len(req.Note) > teamCodeMaxNote {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role == "admin" && !teamOwner(w, r) {
		return
	}
	if req.Role != "member" && req.Role != "admin" {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.MaxUses <= 0 {
		req.MaxUses = 1
	}
	if req.MaxUses > teamCodeMaxUses {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.QuotaToken < 0 || req.QuotaToken > teamCodeMaxQuota {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.QuotaCost < 0 || req.QuotaCost > teamCodeMaxCost {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.QuotaConcurrent < 0 || req.QuotaConcurrent > teamCodeMaxConcurrent {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.GrantValidityDays < 0 || req.GrantValidityDays > teamCodeMaxGrantValidityDays || (req.Kind == "invite" && req.GrantValidityDays != 0) {
		teamFail(w, 400, "invalid_request")
		return
	}
	if req.Kind != "concurrency" && req.QuotaConcurrent != 0 {
		teamFail(w, 400, "invalid_request")
		return
	}
	expiresIn := int64(7 * 24)
	if req.ExpiresIn != nil {
		expiresIn = *req.ExpiresIn
	}
	if expiresIn < 0 || time.Duration(expiresIn)*time.Hour > teamCodeMaxValidity {
		teamFail(w, 400, "invalid_request")
		return
	}
	// A credit voucher only makes sense with a face value — tokens, money, or
	// both — and an invitation with a policy to land in.
	if req.Kind == "credit" && req.QuotaToken <= 0 && req.QuotaCost <= 0 {
		teamFail(w, 400, "invalid_quota")
		return
	}
	if req.Kind == "concurrency" && req.QuotaConcurrent <= 0 {
		teamFail(w, 400, "invalid_quota")
		return
	}
	if req.Kind == "invite" {
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
	} else {
		req.PolicyIDs = nil
		// policy_id is NOT NULL with a foreign key, and a credit voucher has no
		// policy at all — it tops up an account that already exists. Store the
		// site's first policy as an inert placeholder rather than refusing to
		// mint over a column this kind never reads.
		if err := h.db.QueryRow(`SELECT id FROM team_policies ORDER BY id LIMIT 1`).Scan(&req.PolicyID); err != nil {
			teamFail(w, 409, "policy_required")
			return
		}
	}
	var expiry int64 // 0 means that the code has no redemption deadline.
	if expiresIn > 0 {
		expiry = time.Now().Add(time.Duration(expiresIn) * time.Hour).Unix()
	}
	type minted struct {
		ID    int64  `json:"id"`
		Code  string `json:"code"`
		Path  string `json:"path"`
		Label string `json:"label"`
	}
	out := make([]minted, 0, req.Count)
	tx, err := h.db.Begin()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	defer tx.Rollback()
	for i := 0; i < req.Count; i++ {
		raw, err := teamCode()
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		tokenEnc, err := h.enc.Encrypt([]byte(raw))
		if err != nil {
			teamFail(w, 500, "save_failed")
			return
		}
		dbKind := req.Kind
		if dbKind == "concurrency" {
			dbKind = "credit"
		}
		res, err := tx.Exec(`INSERT INTO team_invites(token_hash,token_enc,label,note,policy_id,role,kind,expires_at,max_uses,quota_tokens,quota_cost,quota_concurrent,grant_validity_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			teamHash(stripTeamCode(raw)), tokenEnc, req.Label, req.Note, req.PolicyID, req.Role, dbKind, expiry, req.MaxUses, req.QuotaToken, req.QuotaCost, req.QuotaConcurrent, req.GrantValidityDays)
		if err != nil {
			log.Printf("team: create codes insert kind=%s policy=%d: %v", req.Kind, req.PolicyID, err)
			teamFail(w, 500, "save_failed")
			return
		}
		id, _ := res.LastInsertId()
		for position, policyID := range req.PolicyIDs {
			if _, err := tx.Exec(`INSERT INTO team_invite_policies(invite_id,policy_id,position) VALUES(?,?,?)`, id, policyID, position); err != nil {
				log.Printf("team: create code authorization groups code=%d: %v", id, err)
				teamFail(w, 500, "save_failed")
				return
			}
		}
		out = append(out, minted{ID: id, Code: raw, Path: "/app/accept#invite=" + raw, Label: req.Label})
	}
	if err := tx.Commit(); err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	for _, item := range out {
		h.audit(r, "team.code.create", item.ID)
	}
	teamJSON(w, 201, map[string]any{"codes": out, "expires_at": expiry, "kind": req.Kind})
}

// revealCode 仅在明确请求且兑换码仍有效时返回明文。
func (h *TeamHandler) revealCode(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	query := `SELECT token_enc,expires_at,max_uses,used_count,revoked FROM team_invites WHERE id=? AND kind IN ('invite','credit')`
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" {
		query += ` AND role='member'`
	}
	var tokenEnc string
	var expiresAt int64
	var maxUses, usedCount int
	var revoked bool
	err := h.db.QueryRow(query, id).Scan(&tokenEnc, &expiresAt, &maxUses, &usedCount, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		teamFail(w, 404, "not_found")
		return
	}
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	if revoked || (expiresAt > 0 && expiresAt <= time.Now().Unix()) || usedCount >= maxUses {
		teamFail(w, 409, "code_not_revealable")
		return
	}
	if tokenEnc == "" {
		teamFail(w, 409, "code_unavailable")
		return
	}
	plain, err := h.enc.Decrypt(tokenEnc)
	if err != nil {
		log.Printf("team: decrypt code id=%d: %v", id, err)
		teamFail(w, 500, "code_unavailable")
		return
	}
	h.audit(r, "team.code.reveal", id)
	teamJSON(w, 200, map[string]string{"code": string(plain)})
}

// revokeCode 撤销注册码或额度码，使其不能再次兑换。
func (h *TeamHandler) revokeCode(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	query := `UPDATE team_invites SET revoked=1,token_enc='' WHERE id=? AND kind IN ('invite','credit')`
	args := []any{id}
	if p := teamActor(r); p != nil && p.User != nil && p.User.Role == "admin" {
		query += ` AND role='member'`
	}
	res, err := h.db.Exec(query, args...)
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		teamFail(w, 404, "not_found")
		return
	}
	h.audit(r, "team.code.revoke", id)
	teamJSON(w, 200, map[string]bool{"ok": true})
}

// redeemCredit spends a credit code against the signed-in member's own pool.
func (h *TeamHandler) redeemCredit(w http.ResponseWriter, r *http.Request) {
	p := teamActor(r)
	if p == nil || p.User == nil {
		teamFail(w, 401, "account_login_required")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !teamRead(w, r, &req) {
		return
	}
	code := extractTeamCode(req.Code)
	if code == "" || len(code) > 128 {
		teamFail(w, 400, "invalid_code")
		return
	}
	_ = code
	h.mu.Lock()
	defer h.mu.Unlock()
	tx, err := h.db.Begin()
	if err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	defer tx.Rollback()
	var codeID, quota int64
	var quotaCost float64
	var quotaConcurrent, grantValidityDays int
	now := time.Now()
	// Both caps are enforced by this single statement: the row must still have
	// uses left (used_count < max_uses), and the unique redemption index turns
	// a second attempt by the same account into a constraint error below.
	consume := func(hash string) error {
		return tx.QueryRow(`UPDATE team_invites SET used_count = used_count + 1, consumed_at = COALESCE(consumed_at, ?),
			token_enc=CASE WHEN used_count + 1 >= max_uses THEN '' ELSE token_enc END
			WHERE token_hash=? AND kind='credit' AND revoked=0 AND (expires_at=0 OR expires_at>?) AND used_count < max_uses
			RETURNING id, quota_tokens, quota_cost, quota_concurrent, grant_validity_days`, now.Unix(), hash, now.Unix()).Scan(&codeID, &quota, &quotaCost, &quotaConcurrent, &grantValidityDays)
	}
	var consumeErr error
	for _, candidate := range teamCodeCandidates(req.Code) {
		if consumeErr = consume(candidate); consumeErr == nil {
			break
		}
	}
	if consumeErr != nil {
		teamFail(w, 400, "code_invalid")
		return
	}
	var grantExpiresAt int64
	if grantValidityDays > 0 {
		grantExpiresAt = now.Add(time.Duration(grantValidityDays) * 24 * time.Hour).Unix()
	}
	if _, err := tx.Exec(`INSERT INTO team_code_redemptions(code_id,user_id,quota_tokens,quota_cost,quota_concurrent,grant_expires_at) VALUES(?,?,?,?,?,?)`, codeID, p.User.ID, quota, quotaCost, quotaConcurrent, grantExpiresAt); err != nil {
		// The unique (code_id, user_id) index: this account already redeemed it.
		teamFail(w, 409, "code_already_redeemed")
		return
	}
	// A voucher may carry tokens, money, or both; the pool holds two budgets and
	// the code simply adds to whichever it names.
	var maxConcurrent int
	if err := tx.QueryRow(`UPDATE team_users SET quota_total_tokens = quota_total_tokens + ?, quota_total_cost = quota_total_cost + ?, max_concurrent = max_concurrent + ? WHERE id=? AND max_concurrent <= ? RETURNING max_concurrent`, quota, quotaCost, quotaConcurrent, p.User.ID, 10000-quotaConcurrent).Scan(&maxConcurrent); err != nil {
		teamFail(w, 400, "concurrency_limit_exceeded")
		return
	}
	if quotaConcurrent == 0 {
		_ = tx.QueryRow(`SELECT max_concurrent FROM team_users WHERE id=?`, p.User.ID).Scan(&maxConcurrent)
	}
	if err := tx.Commit(); err != nil {
		teamFail(w, 500, "save_failed")
		return
	}
	h.audit(r, "team.code.redeem", codeID)
	var total, used int64
	var costTotal, costUsed float64
	_ = h.db.QueryRow(`SELECT quota_total_tokens, quota_used_tokens, quota_total_cost, quota_used_cost FROM team_users WHERE id=?`, p.User.ID).Scan(&total, &used, &costTotal, &costUsed)
	teamJSON(w, 200, map[string]any{
		"granted":             quota,
		"quota_total":         total,
		"quota_used":          used,
		"quota_available":     maxInt64(total-used, 0),
		"cost_granted":        quotaCost,
		"cost_total":          costTotal,
		"cost_used":           costUsed,
		"concurrency_granted": quotaConcurrent,
		"max_concurrent":      maxConcurrent,
		"account_redeemed":    true,
	})
}

// myRedemptions returns the signed-in member's account and key-based grant history.
// The original voucher codes are intentionally never exposed.
func (h *TeamHandler) myRedemptions(w http.ResponseWriter, r *http.Request) {
	user := teamActor(r).User
	rows, err := h.db.Query(`SELECT id, created_at, quota_tokens, quota_cost, quota_concurrent, grant_expires_at, grant_expired, target
		FROM (
			SELECT id, CAST(strftime('%s', created_at) AS INTEGER) AS created_at, quota_tokens,
				quota_cost, quota_concurrent, grant_expires_at, grant_expired, 'account' AS target
			FROM team_code_redemptions WHERE user_id=?
			UNION ALL
			SELECT -rc.id, CAST(strftime('%s', rc.redeemed_at) AS INTEGER), rc.quota_tokens,
				0, 0, 0, 0, 'api_key'
			FROM redemption_codes rc
			JOIN downstream_keys k ON k.id=rc.redeemed_by_key_id
			WHERE k.user_id=? AND rc.redeemed_by_key_id<>0 AND rc.redeemed_at IS NOT NULL
		) ORDER BY created_at DESC, id DESC LIMIT 100`, user.ID, user.ID)
	if err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	defer rows.Close()
	type redemption struct {
		ID              int64   `json:"id"`
		CreatedAt       int64   `json:"created_at"`
		QuotaTokens     int64   `json:"quota_tokens"`
		QuotaCost       float64 `json:"quota_cost"`
		QuotaConcurrent int     `json:"quota_concurrent"`
		GrantExpiresAt  int64   `json:"grant_expires_at"`
		GrantExpired    bool    `json:"grant_expired"`
		Target          string  `json:"target"`
	}
	items := []redemption{}
	for rows.Next() {
		var item redemption
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.QuotaTokens, &item.QuotaCost,
			&item.QuotaConcurrent, &item.GrantExpiresAt, &item.GrantExpired, &item.Target); err != nil {
			teamFail(w, 500, "load_failed")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		teamFail(w, 500, "load_failed")
		return
	}
	teamJSON(w, 200, items)
}

// teamCreditView is what a member may see about their own pool. The pool holds
// two independent budgets — tokens and money — and either one running out
// stops the relay, so both are reported.
type teamCreditView struct {
	Total     int64 `json:"total"`
	Used      int64 `json:"used"`
	Available int64 `json:"available"`
	Unlimited bool  `json:"unlimited"`
	// Amounts are in the ledger's unit (USD); the console renders them through
	// the site's currency settings.
	CostTotal     float64 `json:"cost_total"`
	CostUsed      float64 `json:"cost_used"`
	CostAvailable float64 `json:"cost_available"`
	CostUnlimited bool    `json:"cost_unlimited"`
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// creditFor renders the account pool for a member-facing response.
func creditFor(total, used int64, costTotal, costUsed float64) teamCreditView {
	view := teamCreditView{Total: total, Used: used, Available: maxInt64(total-used, 0)}
	if total <= 0 {
		view.Unlimited = true
		view.Available = 0
	}
	view.CostTotal, view.CostUsed = costTotal, costUsed
	if costTotal <= 0 {
		view.CostUnlimited = true
	} else if costTotal > costUsed {
		view.CostAvailable = costTotal - costUsed
	}
	return view
}
