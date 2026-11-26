package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFirstRunAdminSetupCreatesOwnerAndClosesSetup(t *testing.T) {
	e := newTeamTestEnv(t)
	h := &sessionHandler{db: e.db, setupCode: "one-time-code", sessionKey: []byte("setup-session-key")}
	status := httptest.NewRecorder()
	h.setupStatus(status, httptest.NewRequest(http.MethodGet, "/admin/setup/status", nil))
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"required":true`) {
		t.Fatalf("initial setup status: %d %s", status.Code, status.Body.String())
	}

	bad := httptest.NewRecorder()
	badReq := httptest.NewRequest(http.MethodPost, "/admin/setup", strings.NewReader(`{"code":"wrong","username":"owner","password":"secret-password"}`))
	h.setupAdmin(bad, badReq)
	if bad.Code != http.StatusForbidden {
		t.Fatalf("invalid setup code status = %d, want 403", bad.Code)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/setup", strings.NewReader(`{"code":"one-time-code","username":"owner","password":"secret-password"}`))
	h.setupAdmin(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("setup status = %d: %s", w.Code, w.Body.String())
	}
	var session struct {
		Token string `json:"session_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil || !strings.HasPrefix(session.Token, "mg-sess.") {
		t.Fatalf("setup session token = %q, decode error = %v", session.Token, err)
	}
	var username, role string
	if err := e.db.QueryRow(`SELECT username,role FROM team_users WHERE role='owner'`).Scan(&username, &role); err != nil {
		t.Fatal(err)
	}
	if username != "owner" || role != "owner" {
		t.Fatalf("created account = %q/%q", username, role)
	}
	closed := httptest.NewRecorder()
	h.setupStatus(closed, httptest.NewRequest(http.MethodGet, "/admin/setup/status", nil))
	if !strings.Contains(closed.Body.String(), `"required":false`) {
		t.Fatalf("setup remained open: %s", closed.Body.String())
	}
}
