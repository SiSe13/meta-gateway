package httpapi

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/lan/meta-gateway/internal/auth"
	"github.com/lan/meta-gateway/internal/domain"
	"github.com/lan/meta-gateway/internal/store"
)

type downstreamKeyActivity struct {
	ID                int64 `json:"id"`
	CurrentConcurrent int   `json:"current_concurrent"`
}

// listDownstreamKeyActivity 返回所有令牌的实时请求数快照。
func (h *AdminHandler) listDownstreamKeyActivity(w http.ResponseWriter, r *http.Request) {
	keys, err := h.db.DownstreamKey.List()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	result := make([]downstreamKeyActivity, 0, len(keys))
	for _, key := range keys {
		current := 0
		if h.keyInFlight != nil {
			current = h.keyInFlight(key.ID)
		}
		result = append(result, downstreamKeyActivity{ID: key.ID, CurrentConcurrent: current})
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) listDownstreamKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := h.db.DownstreamKey.List()
	if err != nil {
		writeStoreError(w, err)
		return
	}
	// Cost is the persisted billing total per key (SUM of usage_records.cost),
	// not a price×token estimate: each request bills at the resolved model
	// price, so only the recorded cost is authoritative.
	costByKey := map[int64]float64{}
	if h.db.Usage != nil {
		if costs, costErr := h.db.Usage.CostByKey(); costErr == nil {
			costByKey = costs
		} else {
			log.Printf("admin: downstream key costs: %v", costErr)
		}
	}
	usageByKey := map[int64]store.KeyUsageTotals{}
	if h.db.Usage != nil {
		now := time.Now()
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		if totals, usageErr := h.db.Usage.KeyUsageByWindow(today, now.AddDate(0, 0, -30)); usageErr == nil {
			usageByKey = totals
		} else {
			log.Printf("admin: downstream key usage windows: %v", usageErr)
		}
	}
	groupsByUser := make(map[int64][]string)
	// 管理界面需要显示令牌所属用户的名称与登录名，避免只展示无法识别的内部 ID。
	type keyOwner struct {
		name     string
		username string
	}
	ownersByUser := make(map[int64]keyOwner)
	groupRows, groupErr := h.db.Query(`SELECT u.id,u.name,u.username,COALESCE(p.name,'')
		FROM team_users u
		LEFT JOIN team_user_policies up ON up.user_id=u.id
		LEFT JOIN team_policies p ON p.id=up.policy_id
		WHERE u.id IN (SELECT user_id FROM downstream_keys WHERE user_id>0 AND team_deleted_at='')
		ORDER BY u.id,p.id`)
	if groupErr != nil {
		log.Printf("admin: downstream key authorization groups: %v", groupErr)
	} else {
		for groupRows.Next() {
			var userID int64
			var owner keyOwner
			var group string
			if err := groupRows.Scan(&userID, &owner.name, &owner.username, &group); err != nil {
				log.Printf("admin: downstream key authorization groups scan: %v", err)
				break
			}
			ownersByUser[userID] = owner
			if group != "" {
				groupsByUser[userID] = append(groupsByUser[userID], group)
			}
		}
		if err := groupRows.Err(); err != nil {
			log.Printf("admin: downstream key authorization groups rows: %v", err)
		}
		_ = groupRows.Close()
	}
	// Never expose token_hash.
	type safeKey struct {
		ID               int64  `json:"id"`
		UserID           int64  `json:"user_id,omitempty"`
		OwnerName        string `json:"owner_name,omitempty"`
		OwnerUsername    string `json:"owner_username,omitempty"`
		Name             string `json:"name"`
		Enabled          bool   `json:"enabled"`
		Scopes           string `json:"scopes,omitempty"`
		QuotaTotalTokens int64  `json:"quota_total_tokens"`
		QuotaUsedTokens  int64  `json:"quota_used_tokens"`
		// The same budget in money (0 = unlimited). Both are enforced.
		QuotaTotalCost float64 `json:"quota_total_cost"`
		QuotaUsedCost  float64 `json:"quota_used_cost"`
		ModelAllowlist string  `json:"model_allowlist,omitempty"`
		ModelDenylist  string  `json:"model_denylist,omitempty"`
		ExpiresAt      string  `json:"expires_at,omitempty"`
		AllowedIPs     string  `json:"allowed_ips,omitempty"`
		RouteGroupName string  `json:"route_group_name,omitempty"`
		// The tenant group this token is bound to (its quota/rate-limit
		// container). Returned so the console can show and resubmit it; without
		// the field the binding was write-only.
		GroupName           string   `json:"group_name,omitempty"`
		Cost                float64  `json:"cost"`
		TodayTokens         int64    `json:"today_tokens"`
		TodayCost           float64  `json:"today_cost"`
		Last30DaysTokens    int64    `json:"last_30_days_tokens"`
		Last30DaysCost      float64  `json:"last_30_days_cost"`
		CurrentConcurrent   int      `json:"current_concurrent"`
		AuthorizationGroups []string `json:"authorization_groups,omitempty"`
		CreatedAt           string   `json:"created_at"`
		HasToken            bool     `json:"has_token"`
	}
	result := make([]safeKey, 0, len(keys))
	for _, k := range keys {
		// Re-viewable plaintext is available only for keys created after
		// plaintext storage landed (token_enc set).
		hasToken := len(k.TokenEnc) > 0
		usage := usageByKey[k.ID]
		currentConcurrent := 0
		if h.keyInFlight != nil {
			currentConcurrent = h.keyInFlight(k.ID)
		}
		owner := ownersByUser[k.UserID]
		result = append(result, safeKey{
			ID:                  k.ID,
			UserID:              k.UserID,
			OwnerName:           owner.name,
			OwnerUsername:       owner.username,
			Name:                k.Name,
			Enabled:             k.Enabled,
			Scopes:              k.Scopes,
			QuotaTotalTokens:    k.QuotaTotalTokens,
			QuotaUsedTokens:     k.QuotaUsedTokens,
			QuotaTotalCost:      k.QuotaTotalCost,
			QuotaUsedCost:       k.QuotaUsedCost,
			ModelAllowlist:      k.ModelAllowlist,
			ModelDenylist:       k.ModelDenylist,
			ExpiresAt:           k.ExpiresAt,
			AllowedIPs:          k.AllowedIPs,
			RouteGroupName:      k.RouteGroupName,
			GroupName:           k.GroupName,
			Cost:                costByKey[k.ID],
			TodayTokens:         usage.TodayTokens,
			TodayCost:           usage.TodayCost,
			Last30DaysTokens:    usage.MonthTokens,
			Last30DaysCost:      usage.MonthCost,
			CurrentConcurrent:   currentConcurrent,
			AuthorizationGroups: groupsByUser[k.UserID],
			CreatedAt:           k.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			HasToken:            hasToken,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

type createKeyResponse struct {
	ID               int64   `json:"id"`
	Name             string  `json:"name"`
	Token            string  `json:"token"`
	Enabled          bool    `json:"enabled"`
	Scopes           string  `json:"scopes,omitempty"`
	QuotaTotalTokens int64   `json:"quota_total_tokens"`
	QuotaUsedTokens  int64   `json:"quota_used_tokens"`
	QuotaTotalCost   float64 `json:"quota_total_cost"`
	QuotaUsedCost    float64 `json:"quota_used_cost"`
	ModelAllowlist   string  `json:"model_allowlist,omitempty"`
	ModelDenylist    string  `json:"model_denylist,omitempty"`
	ExpiresAt        string  `json:"expires_at,omitempty"`
	AllowedIPs       string  `json:"allowed_ips,omitempty"`
	RouteGroupName   string  `json:"route_group_name,omitempty"`
	GroupName        string  `json:"group_name,omitempty"`
	CreatedAt        string  `json:"created_at"`
}

func (h *AdminHandler) createDownstreamKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		// Token is optional. When empty, the server generates an mg-… secret.
		// When set, the provided secret is stored as a hash only (raw never re-readable).
		Token            string  `json:"token,omitempty"`
		Scopes           string  `json:"scopes,omitempty"`
		QuotaTotalTokens int64   `json:"quota_total_tokens"`
		QuotaTotalCost   float64 `json:"quota_total_cost"`
		GroupName        string  `json:"group_name,omitempty"`
		ModelAllowlist   string  `json:"model_allowlist,omitempty"`
		ModelDenylist    string  `json:"model_denylist,omitempty"`
		ExpiresAt        string  `json:"expires_at,omitempty"`
		AllowedIPs       string  `json:"allowed_ips,omitempty"`
		RouteGroupName   string  `json:"route_group_name,omitempty"`
	}
	if err := decodeJSON(w, r, &req, 0, false); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	normalizedScopes, scopeErr := auth.NormalizeScopes(req.Scopes)
	if scopeErr != nil {
		writeError(w, http.StatusBadRequest, scopeErr.Error())
		return
	}
	req.Scopes = auth.FormatScopes(normalizedScopes)

	raw := auth.NormalizeDownstreamToken(req.Token)
	var hash string
	if raw == "" {
		var genErr error
		hash, raw, genErr = auth.NewToken()
		if genErr != nil {
			writeError(w, http.StatusInternalServerError, "token generation failed")
			return
		}
	} else {
		if err := validateCustomDownstreamToken(raw); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash = auth.HashToken(raw)
		existing, lookupErr := h.db.DownstreamKey.GetByHash(hash)
		if lookupErr != nil {
			writeStoreError(w, lookupErr)
			return
		}
		if existing != nil {
			writeError(w, http.StatusConflict, "token already exists")
			return
		}
	}

	if req.QuotaTotalTokens < 0 {
		writeError(w, http.StatusBadRequest, "quota_total_tokens must be >= 0")
		return
	}
	if req.QuotaTotalCost < 0 {
		writeError(w, http.StatusBadRequest, "quota_total_cost must be >= 0")
		return
	}
	if err := auth.ValidateKeyExpiry(req.ExpiresAt); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := auth.ValidateKeyAllowedIPs(req.AllowedIPs); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Keep the encrypted plaintext token so operators can re-view/copy it
	// later (like New-API). Encrypt failure is non-fatal: the key still works,
	// it just cannot be re-viewed (users can rotate it instead).
	tokenEnc := ""
	if encToken, encErr := h.enc.Encrypt([]byte(raw)); encErr == nil {
		tokenEnc = encToken
	}
	key := &domain.DownstreamKey{
		TokenHash:        hash,
		TokenEnc:         []byte(tokenEnc),
		Name:             req.Name,
		Enabled:          true,
		Scopes:           req.Scopes,
		QuotaTotalTokens: req.QuotaTotalTokens,
		QuotaTotalCost:   req.QuotaTotalCost,
		ModelAllowlist:   strings.TrimSpace(req.ModelAllowlist),
		ModelDenylist:    strings.TrimSpace(req.ModelDenylist),
		ExpiresAt:        strings.TrimSpace(req.ExpiresAt),
		AllowedIPs:       strings.TrimSpace(req.AllowedIPs),
		GroupName:        strings.TrimSpace(req.GroupName),
		RouteGroupName:   strings.TrimSpace(req.RouteGroupName),
	}
	id, err := h.db.DownstreamKey.Create(key)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	createdAt := ""
	if created, err := h.db.DownstreamKey.GetByID(id); err == nil && created != nil {
		createdAt = created.CreatedAt.Format("2006-01-02T15:04:05Z07:00")
	}

	writeJSON(w, http.StatusCreated, createKeyResponse{
		ID:               id,
		Name:             req.Name,
		Token:            raw,
		Enabled:          true,
		Scopes:           req.Scopes,
		QuotaTotalTokens: req.QuotaTotalTokens,
		QuotaUsedTokens:  0,
		QuotaTotalCost:   req.QuotaTotalCost,
		QuotaUsedCost:    0,
		ModelAllowlist:   strings.TrimSpace(req.ModelAllowlist),
		ModelDenylist:    strings.TrimSpace(req.ModelDenylist),
		ExpiresAt:        strings.TrimSpace(req.ExpiresAt),
		AllowedIPs:       strings.TrimSpace(req.AllowedIPs),
		RouteGroupName:   strings.TrimSpace(req.RouteGroupName),
		GroupName:        strings.TrimSpace(req.GroupName),
		CreatedAt:        createdAt,
	})
}

func (h *AdminHandler) updateDownstreamKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	existing, err := h.db.DownstreamKey.GetByID(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "key not found")
		return
	}
	var req struct {
		Name             *string  `json:"name"`
		Enabled          *bool    `json:"enabled"`
		Scopes           *string  `json:"scopes"`
		QuotaTotalTokens *int64   `json:"quota_total_tokens"`
		QuotaTotalCost   *float64 `json:"quota_total_cost"`
		GroupName        *string  `json:"group_name"`
		ModelAllowlist   *string  `json:"model_allowlist"`
		ModelDenylist    *string  `json:"model_denylist"`
		ExpiresAt        *string  `json:"expires_at"`
		AllowedIPs       *string  `json:"allowed_ips"`
		RouteGroupName   *string  `json:"route_group_name"`
		ResetUsed        bool     `json:"reset_used"`
	}
	if err := decodeJSON(w, r, &req, 0, false); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		existing.Name = name
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if req.Scopes != nil {
		normalizedScopes, scopeErr := auth.NormalizeScopes(*req.Scopes)
		if scopeErr != nil {
			writeError(w, http.StatusBadRequest, scopeErr.Error())
			return
		}
		existing.Scopes = auth.FormatScopes(normalizedScopes)
	}
	if req.QuotaTotalTokens != nil {
		if *req.QuotaTotalTokens < 0 {
			writeError(w, http.StatusBadRequest, "quota_total_tokens must be >= 0")
			return
		}
		existing.QuotaTotalTokens = *req.QuotaTotalTokens
	}
	if req.QuotaTotalCost != nil {
		if *req.QuotaTotalCost < 0 {
			writeError(w, http.StatusBadRequest, "quota_total_cost must be >= 0")
			return
		}
		existing.QuotaTotalCost = *req.QuotaTotalCost
	}
	if req.ModelAllowlist != nil {
		existing.ModelAllowlist = strings.TrimSpace(*req.ModelAllowlist)
	}
	if req.ModelDenylist != nil {
		existing.ModelDenylist = strings.TrimSpace(*req.ModelDenylist)
	}
	if req.ExpiresAt != nil {
		if err := auth.ValidateKeyExpiry(*req.ExpiresAt); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		existing.ExpiresAt = strings.TrimSpace(*req.ExpiresAt)
	}
	if req.AllowedIPs != nil {
		if err := auth.ValidateKeyAllowedIPs(*req.AllowedIPs); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		existing.AllowedIPs = strings.TrimSpace(*req.AllowedIPs)
	}
	if req.GroupName != nil {
		existing.GroupName = strings.TrimSpace(*req.GroupName)
	}
	if req.RouteGroupName != nil {
		existing.RouteGroupName = strings.TrimSpace(*req.RouteGroupName)
	}
	// Reset the usage counter before persisting field changes: a reset failure
	// then leaves the row untouched (retry is idempotent), instead of applying
	// the field update but failing half the request.
	if req.ResetUsed {
		if err := h.db.DownstreamKey.ResetUsage(id); err != nil {
			writeStoreError(w, err)
			return
		}
		existing.QuotaUsedTokens = 0
		existing.QuotaUsedCost = 0
	}
	if err := h.db.DownstreamKey.Update(existing); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":                 existing.ID,
		"name":               existing.Name,
		"enabled":            existing.Enabled,
		"scopes":             existing.Scopes,
		"quota_total_tokens": existing.QuotaTotalTokens,
		"quota_used_tokens":  existing.QuotaUsedTokens,
		"quota_total_cost":   existing.QuotaTotalCost,
		"quota_used_cost":    existing.QuotaUsedCost,
		"model_allowlist":    existing.ModelAllowlist,
		"model_denylist":     existing.ModelDenylist,
		"expires_at":         existing.ExpiresAt,
		"allowed_ips":        existing.AllowedIPs,
		"route_group_name":   existing.RouteGroupName,
		"group_name":         existing.GroupName,
		"created_at":         existing.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	})
}

func (h *AdminHandler) deleteDownstreamKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	if err := h.db.DownstreamKey.Delete(id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// revealDownstreamKeyToken returns the stored plaintext token for a key.
// Keys created before plaintext storage landed (token_enc empty) return 404
// so the operator can rotate instead. Admin audit records every reveal.
func (h *AdminHandler) revealDownstreamKeyToken(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	enc, err := h.db.DownstreamKey.GetTokenEnc(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if enc == "" {
		writeError(w, http.StatusNotFound, "token_plaintext_unavailable")
		return
	}
	plain, decryptErr := h.enc.Decrypt(enc)
	if decryptErr != nil {
		writeError(w, http.StatusInternalServerError, "token_decrypt_failed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"token": string(plain)})
}

// rotateDownstreamKeyToken replaces a key's token with a freshly generated
// one; the old token stops working immediately. The new plaintext is returned
// once and also stored encrypted so it can be re-viewed later.
func (h *AdminHandler) rotateDownstreamKeyToken(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id")
	if !ok {
		return
	}
	existing, err := h.db.DownstreamKey.GetByID(id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "downstream key not found")
		return
	}
	hash, raw, genErr := auth.NewToken()
	if genErr != nil {
		writeError(w, http.StatusInternalServerError, "token generation failed")
		return
	}
	tokenEnc, encErr := h.enc.Encrypt([]byte(raw))
	if encErr != nil {
		writeError(w, http.StatusInternalServerError, "encryption failed")
		return
	}
	if err := h.db.DownstreamKey.RotateToken(id, hash, tokenEnc); err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"id": strconv.FormatInt(id, 10), "token": raw})
}
