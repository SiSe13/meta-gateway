package httpapi

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/lan/meta-gateway/internal/auth"
	"github.com/lan/meta-gateway/internal/store"
	"github.com/lan/meta-gateway/internal/totp"
)

// setupStatus只公开是否需要初始化，不泄露初始化码或账号信息。
func (h *sessionHandler) setupStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var count int
	if err := h.db.QueryRow(`SELECT count(*) FROM team_users WHERE role='owner'`).Scan(&count); err != nil {
		writeError(w, 500, "auth_unavailable")
		return
	}
	writeJSON(w, 200, map[string]bool{"required": count == 0 && len(h.adminTokens) == 0})
}

// setupAdmin使用启动日志中的一次性初始化码创建首个站长账号。
func (h *sessionHandler) setupAdmin(w http.ResponseWriter, r *http.Request) {
	if len(h.adminTokens) != 0 {
		writeError(w, 403, "legacy_setup_disabled")
		return
	}
	if !teamOriginOK(r) {
		writeError(w, 403, "csrf_failed")
		return
	}
	if h.loginLimiter != nil {
		if allowed, wait := h.loginLimiter.Allow(hashLoginKey("ip:" + ClientIP(r).String())); !allowed {
			loginRateLimited(w, wait)
			return
		}
	}
	if h.globalLoginLimiter != nil {
		if allowed, wait := h.globalLoginLimiter.Allow(0); !allowed {
			loginRateLimited(w, wait)
			return
		}
	}
	var req struct {
		Code     string `json:"code"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&req); err != nil {
		writeError(w, 400, "invalid body")
		return
	}
	if h.setupCode == "" || subtle.ConstantTimeCompare([]byte(req.Code), []byte(h.setupCode)) != 1 {
		writeError(w, 403, "invalid_setup_code")
		return
	}
	name := strings.ToLower(strings.TrimSpace(req.Username))
	if !teamUsername.MatchString(name) {
		writeError(w, 400, "invalid_username")
		return
	}
	hash, err := hashTeamPassword(req.Password)
	if err != nil {
		writeError(w, 400, "password_length")
		return
	}
	tx, err := h.db.Begin()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`UPDATE operator_preferences SET id=id WHERE id=1`); err != nil {
		writeStoreError(w, err)
		return
	}
	var count int
	if err = tx.QueryRow(`SELECT count(*) FROM team_users WHERE role='owner'`).Scan(&count); err != nil {
		writeStoreError(w, err)
		return
	}
	if count != 0 {
		writeError(w, 409, "owner_exists")
		return
	}
	if _, err = tx.Exec(`UPDATE operator_preferences SET admin_username='' WHERE id=1`); err != nil {
		writeStoreError(w, err)
		return
	}
	if _, err = tx.Exec(`INSERT INTO team_users(username,name,password_hash,role,policy_id) VALUES(?,?,?,'owner',1)`, name, name, hash); err != nil {
		writeError(w, 409, "username_taken")
		return
	}
	if err = tx.Commit(); err != nil {
		writeStoreError(w, err)
		return
	}
	token, err := auth.SignSessionToken(h.sessionKey, sessionTTL)
	if err != nil {
		writeError(w, 500, "session token")
		return
	}
	writeJSON(w, 201, map[string]string{"session_token": token})
}

// operator_onboarding.go owns the first-run claim of the deployment administrator.
//
// A deployment upgrading from a version whose only credential was ADMIN_TOKEN
// starts with no owner account: that token is both the password and the only way
// in, the console can rename the operator but not change the password, and the
// upgrade instructions have to live in the sign-in page's "more options" list.
//
// The claim turns that into one identity — a username plus a stored password —
// and, once it exists, the token stops working as a password. The closing
// condition is the account itself rather than a flag or a "first time" marker,
// so an interrupted or skipped claim simply leaves the upgrade path open for the
// next attempt. ADMIN_TOKEN_LOGIN=break-glass is the documented way back in when
// the owner password is lost.

// ownerClaimed reports whether a real owner credential exists.
func (h *sessionHandler) ownerClaimed() bool {
	var count int
	if err := h.db.QueryRow(`SELECT count(*) FROM team_users WHERE role='owner' AND status='active'`).Scan(&count); err != nil {
		// Fail closed on the read, not open: an unreadable roster must not
		// re-enable a credential path the deployment has already retired.
		return true
	}
	return count > 0
}

// tokenLoginAllowed answers whether ADMIN_TOKEN may still be used as a password.
// The break-glass flag is checked first so a locked-out deployment can always
// recover by restarting with the variable set.
func (h *sessionHandler) tokenLoginAllowed() bool {
	if strings.EqualFold(strings.TrimSpace(h.tokenLoginBreakGlass), "break-glass") {
		return true
	}
	return !h.ownerClaimed()
}

// ownerAccount reads the active owner row, if one exists.
func (h *sessionHandler) ownerAccount() (*TeamUser, error) {
	return scanTeamUser(h.db.QueryRow(teamUserSelect + ` WHERE u.role='owner' AND u.status='active' ORDER BY u.id LIMIT 1`))
}

type onboardingState struct {
	// Required means the console should offer the claim: the deployment is still
	// signing in with ADMIN_TOKEN and has no owner credential.
	Required bool `json:"required"`
	// Username is what to prefill — the operator name this deployment already
	// answers to (ADMIN_USERNAME, or the console's own rename).
	Username string `json:"username"`
	// HasOwner / TokenLogin let the UI explain the two ways in without guessing.
	HasOwner   bool `json:"has_owner"`
	TokenLogin bool `json:"token_login"`
	// TOTPLogin mirrors the second factor: the claim has to ask for it, because
	// the token alone no longer authorizes the change.
	TOTPLogin bool `json:"totp_login"`
	// Mode reports the member module's switch, which is independent of this
	// credential (a personal gateway can still have a claimed owner).
	Mode string `json:"mode"`
}

func (h *sessionHandler) onboardingState() onboardingState {
	state := onboardingState{Username: h.adminUsername, Mode: "personal"}
	if name, err := h.db.OperatorUsername(h.adminUsername); err == nil {
		state.Username = name
	}
	if account, err := h.ownerAccount(); err == nil && account != nil {
		state.HasOwner = true
		if account.Username != "" {
			state.Username = account.Username
		}
	}
	state.Required = !state.HasOwner
	state.TokenLogin = h.tokenLoginAllowed()
	if totpState, err := h.db.AdminTOTP.Get(); err == nil {
		state.TOTPLogin = totpState.Enabled
	}
	if h.team != nil {
		if settings, err := h.team.settings(); err == nil && strings.TrimSpace(settings.Mode) != "" {
			state.Mode = settings.Mode
		}
	}
	return state
}

// onboarding is read by the console's first-run prompt (behind the admin wall).
func (h *sessionHandler) onboarding(w http.ResponseWriter, r *http.Request) {
	if !teamOwner(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, h.onboardingState())
}

// claimOwner sets the deployment's owner credential: one username plus a stored
// password, replacing "the admin token, typed as a password".
//
// It stays behind the current password (or the legacy deployment token during
// upgrade), plus the second factor when enabled, because this changes credentials.
func (h *sessionHandler) claimOwner(w http.ResponseWriter, r *http.Request) {
	if !teamOwner(w, r) {
		return
	}
	if !teamOriginOK(r) {
		writeError(w, 403, "csrf_failed")
		return
	}
	var req struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		Token           string `json:"token"`
		CurrentPassword string `json:"current_password"`
		TOTP            string `json:"totp_code"`
	}
	if err := decodeJSON(w, r, &req, 0, false); err != nil {
		return
	}
	// No login limiter here on purpose: this endpoint sits behind the admin wall,
	// so the token is a confirmation rather than a guessable password — and
	// spending the sign-in bucket on it locked the operator out of the sign-in
	// form for a minute right after claiming their own account.
	// Reauthentication prevents a stolen browser session from replacing credentials.
	authorized := auth.ValidAdminToken(req.Token, h.adminTokens)
	if !authorized && req.CurrentPassword != "" {
		account, accountErr := h.ownerAccount()
		authorized = accountErr == nil && account != nil && checkTeamPassword(account.PasswordHash, req.CurrentPassword)
	}
	if !authorized {
		writeError(w, 403, "invalid_credentials")
		return
	}
	state, err := h.db.AdminTOTP.Get()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if state.Enabled {
		secret, derr := h.enc.Decrypt(state.SecretEncrypted)
		if derr != nil || !totp.Verify(string(secret), req.TOTP, time.Now()) {
			writeError(w, 403, "totp_required")
			return
		}
	}
	name := strings.ToLower(strings.TrimSpace(req.Username))
	if !teamUsername.MatchString(name) {
		writeError(w, 400, "invalid_username")
		return
	}
	hash, hashErr := hashTeamPassword(req.Password)
	if hashErr != nil {
		writeError(w, 400, "password_length")
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	defer tx.Rollback()
	// Take SQLite's write lock before reading the roster, so two concurrent
	// claims cannot both decide they are creating the first owner.
	if _, err = tx.Exec(`UPDATE operator_preferences SET id=id WHERE id=1`); err != nil {
		writeStoreError(w, err)
		return
	}
	var ownerID int64
	var taken int
	if err = tx.QueryRow(`SELECT count(*) FROM team_users WHERE lower(username)=? AND role<>'owner'`, name).Scan(&taken); err != nil {
		writeStoreError(w, err)
		return
	}
	if taken > 0 {
		writeError(w, 409, "username_taken")
		return
	}
	err = tx.QueryRow(`SELECT id FROM team_users WHERE role='owner' AND status='active' ORDER BY id LIMIT 1`).Scan(&ownerID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// The same insert the mode switch performs: the operator and the owner
		// are one identity, not two rows that would shadow each other.
		if _, err = tx.Exec(`INSERT INTO team_users(username,name,password_hash,role,policy_id)
			VALUES(?,?,?,'owner',1)`, name, name, hash); err != nil {
			writeError(w, 409, "username_taken")
			return
		}
	case err != nil:
		writeStoreError(w, err)
		return
	default:
		// An existing owner: this is a credential change, so other sessions on
		// that account must not survive it.
		if _, err = tx.Exec(`UPDATE team_users SET username=?,name=?,password_hash=?,session_version=session_version+1 WHERE id=?`,
			name, name, hash, ownerID); err != nil {
			writeError(w, 409, "username_taken")
			return
		}
	}
	// The operator name reservation existed to keep a team account from
	// shadowing the deployment credential. That credential is now the owner row
	// itself, protected by the username index — exactly as when a deployment
	// switches to team mode.
	if _, err = tx.Exec(`UPDATE operator_preferences SET admin_username='' WHERE id=1`); err != nil {
		writeStoreError(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		writeStoreError(w, err)
		return
	}

	account, err := h.ownerAccount()
	if err == nil && account != nil {
		// A team session's account version moved, so re-issue its cookie: the
		// operator must not be signed out by setting their own password.
		if principal := teamActor(r); principal != nil && principal.User != nil {
			if _, sessionErr := h.team.startSession(w, r, account); sessionErr != nil {
				// The credentials are stored either way; the console will ask
				// for a sign-in again rather than reporting a failed claim.
				writeJSON(w, http.StatusOK, map[string]any{"reauthenticate": true, "onboarding": h.onboardingState()})
				return
			}
		}
	}
	id := ownerID
	if id == 0 && account != nil {
		id = account.ID
	}
	event := &store.AuditEvent{
		RequestID:    chimw.GetReqID(r.Context()),
		ActorKind:    "admin",
		Action:       "operator.claim",
		ResourceKind: "operator",
		ResourceID:   &id,
		Outcome:      "success",
		StatusCode:   http.StatusOK,
	}
	_ = h.db.AuditEvent.Insert(event)
	writeJSON(w, http.StatusOK, map[string]any{"onboarding": h.onboardingState()})
}
