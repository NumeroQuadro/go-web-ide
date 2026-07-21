package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeExecutor struct {
	result execResult
}

func (f *fakeExecutor) Run(_ context.Context, _ []workspaceFile) execResult {
	return f.result
}

func TestServer_InternalRun_Unauthorized(t *testing.T) {
	s := &server{
		cfg: config{
			SharedSecret: "secret",
			MaxCodeBytes: 1024,
			Timeout:      50 * time.Millisecond,
		},
		exec: &fakeExecutor{},
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/run", bytes.NewBufferString(`{"files":[{"path":"main.go","content":"package main\nfunc main(){}"}]}`))
	rr := httptest.NewRecorder()

	s.routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestServer_InternalRun_Valid(t *testing.T) {
	exit := 0
	s := &server{
		cfg: config{
			SharedSecret:   "secret",
			MaxCodeBytes:   1024,
			MaxOutputBytes: 1024,
			Timeout:        50 * time.Millisecond,
		},
		exec: &fakeExecutor{
			result: execResult{
				Stdout:        "hi\n",
				Stderr:        "",
				ExitCode:      &exit,
				TimedOut:      false,
				Truncated:     false,
				InternalError: false,
			},
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/run", bytes.NewBufferString(`{"files":[{"path":"main.go","content":"package main\nfunc main(){println(\"hi\")}"}]}`))
	req.Header.Set("X-Runner-Secret", "secret")
	rr := httptest.NewRecorder()

	s.routes().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want %d", rr.Code, http.StatusOK)
	}

	var resp runResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Stdout != "hi\n" || resp.Stderr != "" {
		t.Fatalf("stdout/stderr mismatch: %+v", resp)
	}
	if resp.ExitCode == nil || *resp.ExitCode != 0 {
		t.Fatalf("exit_code=%v, want 0", resp.ExitCode)
	}
	if resp.InternalError {
		t.Fatalf("expected internal_error=false")
	}
}

func TestServer_Healthz(t *testing.T) {
	s := &server{
		cfg: config{},
		exec: &fakeExecutor{
			result: execResult{},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	s.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d, want %d", rr.Code, http.StatusOK)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type=%q, want application/json", ct)
	}
	if got := bytes.TrimSpace(rr.Body.Bytes()); string(got) != `{"ok":true}` {
		t.Fatalf("body=%q, want %q", string(got), `{"ok":true}`)
	}
}
