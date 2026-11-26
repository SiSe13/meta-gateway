package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxCheckinResponseBytes = 2 << 20

type CheckinOutcome string

const (
	CheckinSuccess CheckinOutcome = "success"
	CheckinSkipped CheckinOutcome = "skipped"
)

type CheckinInput struct {
	BaseURL        string
	Secret         string
	Cookie         string
	AuthMode       AuthMode
	PlatformUserID int64
	// CheckinPath/Method override the site-relative endpoint. Empty uses the
	// platform default; common New-API forks default to POST /api/user/checkin.
	CheckinPath   string
	CheckinMethod string
	// Headers are extra request headers for site-specific check-in endpoints.
	// Host / Cookie / hop-by-hop headers are ignored.
	Headers map[string]string
	// Body supports site-specific POST APIs that require a JSON payload.
	Body string
}

type CheckinResult struct {
	Outcome  CheckinOutcome
	Category string
	Message  string
	Reward   string
}

type CheckinAdapter interface {
	Name() string
	// RequiresPlatformUserID reports whether the upstream expects user-id headers
	// (New API family). One API typically does not.
	RequiresPlatformUserID() bool
	Checkin(context.Context, CheckinInput) (CheckinResult, error)
}

type CheckinError struct {
	Kind   ErrorKind
	Status int
	// Message is a safe operator-facing detail (never secrets). Empty means use a generic fallback.
	Message string
}

func (e *CheckinError) Error() string {
	if e == nil {
		return "check-in failed"
	}
	if strings.TrimSpace(e.Message) != "" {
		if e.Status != 0 {
			return fmt.Sprintf("check-in failed: %s (%d): %s", e.Kind, e.Status, e.Message)
		}
		return fmt.Sprintf("check-in failed: %s: %s", e.Kind, e.Message)
	}
	if e.Status != 0 {
		return fmt.Sprintf("check-in failed: %s (%d)", e.Kind, e.Status)
	}
	return fmt.Sprintf("check-in failed: %s", e.Kind)
}

type JSONCheckinAdapter struct {
	name       string
	client     *http.Client
	userHeader bool
}

func NewJSONCheckinAdapter(name string, client *http.Client, userHeader bool) *JSONCheckinAdapter {
	if client == nil {
		client = &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: 15 * time.Second}}
	}
	return &JSONCheckinAdapter{name: name, client: client, userHeader: userHeader}
}

func (a *JSONCheckinAdapter) Name() string { return a.name }

func (a *JSONCheckinAdapter) RequiresPlatformUserID() bool { return a.userHeader }

func (a *JSONCheckinAdapter) Checkin(ctx context.Context, input CheckinInput) (CheckinResult, error) {
	path := strings.TrimSpace(input.CheckinPath)
	if path == "" {
		path = "/api/user/checkin"
	}
	endpoint, err := checkinEndpoint(input.BaseURL, path)
	if err != nil {
		return CheckinResult{}, &CheckinError{Kind: ErrorInvalidURL}
	}
	method := strings.ToUpper(strings.TrimSpace(input.CheckinMethod))
	if method == "" {
		method = http.MethodPost
	}
	if method != http.MethodPost && method != http.MethodGet {
		return CheckinResult{}, &CheckinError{Kind: ErrorPayload, Message: "unsupported check-in method"}
	}
	body := ""
	if method == http.MethodPost {
		body = input.Body
	}

	mode := normalizeAuthMode(input.AuthMode)
	var bearer *checkinAuth
	if mode != AuthCookie && strings.TrimSpace(input.Secret) != "" {
		bearer = &checkinAuth{bearer: strings.TrimSpace(input.Secret)}
	}
	cookies := cookieAuthCandidates(input)
	if bearer == nil && len(cookies) == 0 {
		return CheckinResult{}, &CheckinError{Kind: ErrorPayload, Message: "check-in requires an access token or cookie"}
	}

	var firstResult CheckinResult
	var firstErr error
	fallbackAllowed := bearer == nil
	if bearer != nil {
		result, requestErr := a.checkinRequest(ctx, endpoint, method, body, input, *bearer, false)
		if requestErr == nil && result.Outcome == CheckinSuccess {
			return result, nil
		}
		firstResult, firstErr = result, requestErr
		if requestErr != nil && (errors.Is(requestErr, context.Canceled) || errors.Is(requestErr, context.DeadlineExceeded)) {
			return CheckinResult{}, requestErr
		}
		fallbackAllowed = shouldFallbackCheckin(result, requestErr)
	}

	// New-API forks may expose the browser's sign_in action. Try it before the
	// cookie-form checkin endpoint, matching the site's own account workflow.
	if fallbackAllowed && strings.TrimSpace(input.CheckinPath) == "" && method == http.MethodPost && len(cookies) > 0 {
		legacyEndpoint, endpointErr := checkinEndpoint(input.BaseURL, "/api/user/sign_in")
		if endpointErr == nil {
			for _, auth := range cookies {
				result, requestErr := a.checkinRequest(ctx, legacyEndpoint, http.MethodPost, "{}", input, auth, true)
				if requestErr == nil && result.Outcome == CheckinSuccess {
					return result, nil
				}
				if requestErr != nil && (errors.Is(requestErr, context.Canceled) || errors.Is(requestErr, context.DeadlineExceeded)) {
					return CheckinResult{}, requestErr
				}
				if firstErr == nil && (firstResult.Outcome == "" || (firstResult.Outcome == CheckinSkipped && requestErr != nil)) {
					firstResult, firstErr = result, requestErr
				}
			}
		}
	}
	if fallbackAllowed {
		for _, auth := range cookies {
			result, requestErr := a.checkinRequest(ctx, endpoint, method, body, input, auth, false)
			if requestErr == nil && result.Outcome == CheckinSuccess {
				return result, nil
			}
			if requestErr != nil && (errors.Is(requestErr, context.Canceled) || errors.Is(requestErr, context.DeadlineExceeded)) {
				return CheckinResult{}, requestErr
			}
			if firstErr == nil && (firstResult.Outcome == "" || (firstResult.Outcome == CheckinSkipped && requestErr != nil)) {
				firstResult, firstErr = result, requestErr
			}
			if !shouldFallbackCheckin(result, requestErr) {
				break
			}
		}
	}
	if firstErr != nil {
		return CheckinResult{}, firstErr
	}
	return firstResult, nil
}

type checkinAuth struct {
	bearer string
	cookie string
}

// cookieAuthCandidates mirrors the common New-API session-cookie formats used by site forks.
func cookieAuthCandidates(input CheckinInput) []checkinAuth {
	if cookie := strings.TrimSpace(input.Cookie); cookie != "" {
		return []checkinAuth{{cookie: cookie}}
	}
	secret := strings.TrimSpace(input.Secret)
	if secret == "" {
		return nil
	}
	if hasKnownSessionCookie(secret) {
		return []checkinAuth{{cookie: secret}}
	}
	return []checkinAuth{{cookie: "session=" + secret}, {cookie: "token=" + secret}}
}

func hasKnownSessionCookie(value string) bool {
	for _, part := range strings.Split(value, ";") {
		name, _, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(name)) {
		case "session", "token", "auth_token", "access_token", "jwt", "jwt_token":
			return true
		}
	}
	return false
}

// shouldFallbackCheckin retries alternate cookie auth only for endpoint/auth-shaped failures.
func shouldFallbackCheckin(result CheckinResult, err error) bool {
	if err == nil {
		return result.Category == "unsupported"
	}
	var checkinErr *CheckinError
	if !errors.As(err, &checkinErr) {
		return false
	}
	switch checkinErr.Kind {
	case ErrorTransport:
		return true
	case ErrorStatus:
		return checkinErr.Status == http.StatusUnauthorized || checkinErr.Status == http.StatusForbidden ||
			checkinErr.Status == http.StatusNotFound || checkinErr.Status == http.StatusMethodNotAllowed
	case ErrorPayload:
		message := strings.ToLower(checkinErr.Message)
		for _, marker := range []string{"unauthorized", "forbidden", "access token", "new-api-user", "invalid token", "not login", "not logged", "未登录", "未提供", "未授权"} {
			if strings.Contains(message, marker) {
				return true
			}
		}
	}
	return false
}

// checkinRequest sends one auth variant and normalizes its response.
func (a *JSONCheckinAdapter) checkinRequest(ctx context.Context, endpoint, method, body string, input CheckinInput, auth checkinAuth, browserAction bool) (CheckinResult, error) {
	var reader io.Reader
	if method == http.MethodPost && body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return CheckinResult{}, &CheckinError{Kind: ErrorInvalidURL}
	}
	if auth.cookie != "" {
		req.Header.Set("Cookie", auth.cookie)
	} else if auth.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+auth.bearer)
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	if browserAction {
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
		req.Header.Set("User-Agent", defaultCheckinUserAgent)
		if parsed, parseErr := url.Parse(endpoint); parseErr == nil {
			origin := parsed.Scheme + "://" + parsed.Host
			req.Header.Set("Origin", origin)
			req.Header.Set("Referer", origin+"/")
		}
	}
	if a.userHeader {
		ApplyCompatUserIDHeaders(req.Header, input.PlatformUserID)
	}
	for key, value := range input.Headers {
		if key != "" && checksumHeaderAllowed(key) {
			req.Header.Set(key, value)
		}
	}

	resp, err := a.client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return CheckinResult{}, err
		}
		return CheckinResult{}, &CheckinError{Kind: ErrorTransport}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return CheckinResult{Outcome: CheckinSkipped, Category: "unsupported", Message: "check-in is not supported"}, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return CheckinResult{}, &CheckinError{
			Kind: ErrorStatus, Status: resp.StatusCode, Message: explainCheckinHTTPStatus(resp.StatusCode),
		}
	}
	limited := io.LimitReader(resp.Body, maxCheckinResponseBytes+1)
	responseBody, err := io.ReadAll(limited)
	if err != nil {
		return CheckinResult{}, &CheckinError{Kind: ErrorTransport}
	}
	if len(responseBody) > maxCheckinResponseBytes {
		return CheckinResult{}, &CheckinError{Kind: ErrorTooLarge}
	}
	var payload struct {
		Success *bool  `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Reward       any `json:"reward"`
			QuotaAwarded any `json:"quota_awarded"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil || payload.Success == nil {
		return CheckinResult{}, &CheckinError{
			Kind:    ErrorPayload,
			Message: "upstream body was not valid check-in JSON (missing success field)",
		}
	}
	if *payload.Success {
		reward := payload.Data.Reward
		if reward == nil {
			reward = payload.Data.QuotaAwarded
		}
		return CheckinResult{
			Outcome:  CheckinSuccess,
			Category: "checked_in",
			Message:  "check-in succeeded",
			Reward:   rewardString(reward),
		}, nil
	}
	if alreadyCheckedIn(payload.Message) {
		return CheckinResult{Outcome: CheckinSuccess, Category: "already_checked_in", Message: "already checked in"}, nil
	}
	if unsupportedCheckin(payload.Message) {
		return CheckinResult{Outcome: CheckinSkipped, Category: "unsupported", Message: "check-in is not supported"}, nil
	}
	// success:false with an unrecognized message — surface the upstream text so operators can act.
	detail := strings.TrimSpace(payload.Message)
	if detail == "" {
		detail = "upstream rejected check-in without a message"
	}
	return CheckinResult{}, &CheckinError{
		Kind:    ErrorPayload,
		Message: redactCheckinDetail(detail),
	}
}

const defaultCheckinUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

func checkinEndpoint(baseURL, checkinPath string) (string, error) {
	// Same base normalization as account self/token probes: strip trailing /v1 so
	// OpenAI-style site URLs still hit check-in APIs on the site root.
	path := strings.TrimSpace(checkinPath)
	if path == "" || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\\?#%") || strings.Contains(path, "..") {
		return "", errors.New("invalid check-in path")
	}
	return accountEndpoint(baseURL, path)
}

func rewardString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case json.Number:
		return v.String()
	default:
		return ""
	}
}

func alreadyCheckedIn(message string) bool {
	lower := strings.ToLower(strings.TrimSpace(message))
	for _, marker := range []string{
		"already checked in", "already signed", "already sign in",
		"\u4eca\u65e5\u5df2\u7b7e\u5230", "\u4eca\u5929\u5df2\u7b7e\u5230",
		"\u4eca\u5929\u5df2\u7ecf\u7b7e\u5230", "\u4eca\u65e5\u5df2\u7ecf\u7b7e\u5230",
		"\u5df2\u7ecf\u7b7e\u5230", "\u5df2\u7b7e\u5230", "\u91cd\u590d\u7b7e\u5230", "\u7b7e\u5230\u8fc7",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// explainCheckinHTTPStatus turns a non-2xx status into an operator-facing reason.
// 404 is handled earlier as "unsupported" and never reaches here.
func explainCheckinHTTPStatus(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "HTTP 401 unauthorized — user token expired, wrong secret, or missing auth"
	case http.StatusForbidden:
		return "HTTP 403 forbidden — no permission, IP blocked, or Cloudflare/WAF challenge"
	case http.StatusMethodNotAllowed:
		return "HTTP 405 method not allowed — this path exists but does not accept this method; set the exact path the site's own check-in button calls (外部签到 → 签到路径)"
	case http.StatusRequestTimeout:
		return "HTTP 408 request timeout from upstream"
	case http.StatusTooManyRequests:
		return "HTTP 429 rate limited — slow down or wait before retrying"
	case http.StatusBadGateway:
		return "HTTP 502 bad gateway — upstream reverse proxy or origin is down"
	case http.StatusServiceUnavailable:
		return "HTTP 503 service unavailable — site overloaded, maintenance, or Cloudflare block"
	case http.StatusGatewayTimeout:
		return "HTTP 504 gateway timeout — origin did not answer in time"
	case 520, 521, 522, 523, 524, 525, 526, 530:
		return fmt.Sprintf("HTTP %d Cloudflare / edge error — origin unreachable or TLS issue", status)
	default:
		if status >= 500 {
			return fmt.Sprintf("HTTP %d server error — site or gateway fault", status)
		}
		if status >= 400 {
			return fmt.Sprintf("HTTP %d client error — request rejected by upstream", status)
		}
		return fmt.Sprintf("HTTP %d unexpected status from check-in endpoint", status)
	}
}

// redactCheckinDetail keeps upstream failure text useful while avoiding long dumps / obvious secrets.
func redactCheckinDetail(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ""
	}
	const maxLen = 240
	if len(trimmed) > maxLen {
		trimmed = trimmed[:maxLen] + "…"
	}
	// Drop common secret-looking fragments if an upstream echoes them.
	lower := strings.ToLower(trimmed)
	for _, marker := range []string{"bearer ", "sk-", "access_token", "session-secret"} {
		if strings.Contains(lower, marker) {
			return "upstream rejected check-in (detail redacted)"
		}
	}
	return trimmed
}

func unsupportedCheckin(message string) bool {
	lower := strings.ToLower(strings.TrimSpace(message))
	for _, marker := range []string{
		"invalid url (post /api/user/checkin)",
		"checkin endpoint not found",
		"check-in is not supported",
		"checkin is not supported",
		"does not support checkin",
		"not support checkin",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
