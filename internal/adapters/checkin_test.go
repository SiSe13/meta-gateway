package adapters

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestJSONCheckinAdapterCookieAuth(t *testing.T) {
	var gotAuth, gotCookie string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotCookie = r.Header.Get("Cookie")
		_, _ = io.WriteString(w, `{"success":true}`)
	}))
	defer server.Close()
	_, err := NewJSONCheckinAdapter("new-api", server.Client(), true).Checkin(context.Background(), CheckinInput{
		BaseURL: server.URL, Secret: "must-not-be-bearer", Cookie: "auth_token=cookie-value", AuthMode: AuthCookie,
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "" || gotCookie != "auth_token=cookie-value" {
		t.Fatalf("auth=%q cookie=%q", gotAuth, gotCookie)
	}
}

func TestJSONCheckinAdapter(t *testing.T) {
	var gotAuth string
	gotUsers := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		for _, name := range CompatUserIDHeaderNames {
			if value := r.Header.Get(name); value != "" {
				gotUsers[name] = value
			}
		}
		if r.Method != http.MethodPost || r.URL.Path != "/root/api/user/checkin" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"success":true,"message":"secret response","data":{"reward":1.25}}`)
	}))
	defer server.Close()

	adapter := NewJSONCheckinAdapter("new-api", server.Client(), true)
	result, err := adapter.Checkin(context.Background(), CheckinInput{
		BaseURL:        server.URL + "/root?secret=x",
		Secret:         "session-secret",
		PlatformUserID: 42,
	})
	if err != nil || result.Category != "checked_in" || result.Reward != "1.25" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if gotAuth != "Bearer session-secret" {
		t.Fatalf("headers auth=%q", gotAuth)
	}
	for _, name := range CompatUserIDHeaderNames {
		if gotUsers[name] != "42" {
			t.Fatalf("missing fan-out header %s: %#v", name, gotUsers)
		}
	}
	if strings.Contains(result.Message, "secret response") {
		t.Fatalf("raw message leaked: %+v", result)
	}
}

func TestJSONCheckinNormalizationAndErrors(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		body     string
		outcome  CheckinOutcome
		category string
		errKind  ErrorKind
	}{
		{"already", 200, `{"success":false,"message":"\u4eca\u5929\u5df2\u7ecf\u7b7e\u5230\u8fc7\u5566"}`, CheckinSuccess, "already_checked_in", ""},
		{"unsupported-status", 404, `private body`, CheckinSkipped, "unsupported", ""},
		{"unsupported-message", 200, `{"success":false,"message":"Invalid URL (POST /api/user/checkin) token=private"}`, CheckinSkipped, "unsupported", ""},
		{"status", 503, `session-secret private`, "", "", ErrorStatus},
		{"payload", 200, `not json session-secret`, "", "", ErrorPayload},
		{"missing-success", 200, `{"message":"looks plausible"}`, "", "", ErrorPayload},
	}

	t.Run("rejected-with-message", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, `{"success":false,"message":"余额不足，无法签到"}`)
		}))
		defer s.Close()
		_, err := NewJSONCheckinAdapter("new-api", s.Client(), true).Checkin(t.Context(), CheckinInput{BaseURL: s.URL, Secret: "session-secret"})
		var checkinErr *CheckinError
		if !errors.As(err, &checkinErr) || checkinErr.Kind != ErrorPayload {
			t.Fatalf("err=%v", err)
		}
		if checkinErr.Message != "余额不足，无法签到" {
			t.Fatalf("message=%q", checkinErr.Message)
		}
	})

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer s.Close()

			result, err := NewJSONCheckinAdapter("new-api", s.Client(), true).Checkin(t.Context(), CheckinInput{BaseURL: s.URL, Secret: "session-secret"})
			if tc.errKind == "" {
				if err != nil || result.Outcome != tc.outcome || result.Category != tc.category {
					t.Fatalf("result=%+v err=%v", result, err)
				}
				return
			}
			var checkinErr *CheckinError
			if !errors.As(err, &checkinErr) || checkinErr.Kind != tc.errKind {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if tc.errKind == ErrorStatus {
				if checkinErr.Status != tc.status || !strings.Contains(checkinErr.Message, fmt.Sprintf("%d", tc.status)) {
					t.Fatalf("status error should cite HTTP code: %+v", checkinErr)
				}
			}
			if strings.Contains(err.Error(), "session-secret") || strings.Contains(err.Error(), "private") {
				t.Fatalf("error leaked data: %v", err)
			}
		})
	}
}

func TestJSONCheckinAdapterReadsQuotaAwardedReward(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"success":true,"data":{"quota_awarded":1250}}`)
	}))
	defer server.Close()

	result, err := NewJSONCheckinAdapter("new-api", server.Client(), true).Checkin(context.Background(), CheckinInput{
		BaseURL: server.URL,
		Secret:  "session-secret",
	})
	if err != nil || result.Reward != "1250" {
		t.Fatalf("reward=%q err=%v", result.Reward, err)
	}
}

func TestJSONCheckinAdapterLimitsCancellationAndHeaders(t *testing.T) {
	t.Run("oversized", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, strings.Repeat("x", maxCheckinResponseBytes+1))
		}))
		defer s.Close()
		_, err := NewJSONCheckinAdapter("new-api", s.Client(), true).Checkin(t.Context(), CheckinInput{BaseURL: s.URL, Secret: "secret"})
		var checkinErr *CheckinError
		if !errors.As(err, &checkinErr) || checkinErr.Kind != ErrorTooLarge {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("cancellation", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		defer s.Close()
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, err := NewJSONCheckinAdapter("new-api", s.Client(), true).Checkin(ctx, CheckinInput{BaseURL: s.URL, Secret: "secret"})
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("one-api-omits-user-header", func(t *testing.T) {
		var gotUser string
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotUser = r.Header.Get("New-Api-User")
			_, _ = io.WriteString(w, `{"success":true}`)
		}))
		defer s.Close()
		_, err := NewJSONCheckinAdapter("one-api", s.Client(), false).Checkin(t.Context(), CheckinInput{BaseURL: s.URL, Secret: "secret", PlatformUserID: 42})
		if err != nil || gotUser != "" {
			t.Fatalf("header=%q err=%v", gotUser, err)
		}
	})

	t.Run("invalid-url", func(t *testing.T) {
		_, err := NewJSONCheckinAdapter("new-api", nil, true).Checkin(t.Context(), CheckinInput{BaseURL: "https://user:secret@example.com", Secret: "secret"})
		var checkinErr *CheckinError
		if !errors.As(err, &checkinErr) || checkinErr.Kind != ErrorInvalidURL {
			t.Fatalf("err=%v", err)
		}
	})
}

func TestResolveCheckinAliases(t *testing.T) {
	r := NewRegistry(nil)
	for _, name := range []string{"new-api", "newapi", "one-api", "oneapi"} {
		if _, ok := r.ResolveCheckin(name); !ok {
			t.Fatalf("missing %s", name)
		}
	}
	if _, ok := r.ResolveCheckin("openai-compatible"); ok {
		t.Fatal("openai-compatible must not advertise check-in")
	}
}

func TestJSONCheckinAdapterStripsTrailingV1(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/user/checkin" {
			t.Fatalf("path=%q", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"success":true,"data":{"reward":1}}`)
	}))
	defer server.Close()

	adapter := NewJSONCheckinAdapter("new-api", server.Client(), true)
	result, err := adapter.Checkin(context.Background(), CheckinInput{
		BaseURL:        server.URL + "/v1",
		Secret:         "tok",
		PlatformUserID: 1,
	})
	if err != nil || result.Category != "checked_in" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestJSONCheckinAdapterHonorsEndpointAndMethodOverride(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		_, _ = io.WriteString(w, `{"success":true}`)
	}))
	defer server.Close()

	result, err := NewJSONCheckinAdapter("new-api", server.Client(), true).Checkin(t.Context(), CheckinInput{
		BaseURL: server.URL + "/v1", Secret: "secret", CheckinPath: "/custom/daily", CheckinMethod: http.MethodPost,
		Body: `{"date":"today"}`,
	})
	if err != nil || result.Outcome != CheckinSuccess {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if gotMethod != http.MethodPost || gotPath != "/custom/daily" || gotBody != `{"date":"today"}` {
		t.Fatalf("request = %s %s %s", gotMethod, gotPath, gotBody)
	}
}

func TestJSONCheckinAdapterFallsBackToCookieSignIn(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/user/checkin":
			if r.Header.Get("Authorization") != "" {
				http.Error(w, `{"message":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			http.NotFound(w, r)
		case "/api/user/sign_in":
			if r.Header.Get("Cookie") != "session=session-token" || r.Header.Get("X-Requested-With") != "XMLHttpRequest" {
				t.Errorf("missing browser session headers: cookie=%q xrw=%q", r.Header.Get("Cookie"), r.Header.Get("X-Requested-With"))
			}
			_, _ = io.WriteString(w, `{"success":true,"message":"checked in"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := NewJSONCheckinAdapter("new-api", server.Client(), true).Checkin(t.Context(), CheckinInput{
		BaseURL: server.URL, Secret: "session-token", PlatformUserID: 123,
	})
	if err != nil || result.Outcome != CheckinSuccess {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if len(paths) < 2 || paths[len(paths)-1] != "/api/user/sign_in" {
		t.Fatalf("fallback sequence = %#v", paths)
	}
}
