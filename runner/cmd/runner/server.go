package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"path"
	"strings"
	"time"
)

type runRequest struct {
	Files []workspaceFile `json:"files"`
}

type workspaceFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type runResponse struct {
	Stdout        string `json:"stdout"`
	Stderr        string `json:"stderr"`
	ExitCode      *int   `json:"exit_code"`
	DurationMS    int64  `json:"duration_ms"`
	TimedOut      bool   `json:"timed_out"`
	Truncated     bool   `json:"truncated"`
	InternalError bool   `json:"internal_error"`
}

type executor interface {
	Run(ctx context.Context, files []workspaceFile) execResult
}

type execResult struct {
	Stdout        string
	Stderr        string
	ExitCode      *int
	TimedOut      bool
	Truncated     bool
	InternalError bool
}

type server struct {
	cfg  config
	exec executor
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("POST /internal/run", s.handleInternalRun)

	return mux
}

func (s *server) handleInternalRun(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(s.cfg.SharedSecret) == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "runner_secret_not_configured",
		})
		return
	}

	if r.Header.Get("X-Runner-Secret") != s.cfg.SharedSecret {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "unauthorized",
		})
		return
	}

	req, err := readRunRequest(w, r, s.cfg.MaxCodeBytes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
		return
	}

	start := time.Now()
	result := s.exec.Run(r.Context(), req.Files)
	resp := runResponse{
		Stdout:        result.Stdout,
		Stderr:        result.Stderr,
		ExitCode:      result.ExitCode,
		DurationMS:    time.Since(start).Milliseconds(),
		TimedOut:      result.TimedOut,
		Truncated:     result.Truncated,
		InternalError: result.InternalError,
	}

	writeJSON(w, http.StatusOK, resp)
}

func readRunRequest(w http.ResponseWriter, r *http.Request, maxCodeBytes int64) (runRequest, error) {
	// JSON adds overhead. Keep the body cap small, but larger than maxCodeBytes
	// so a near-limit code string can still be decoded.
	r.Body = http.MaxBytesReader(w, r.Body, maxCodeBytes+8192)

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	var req runRequest
	if err := decoder.Decode(&req); err != nil {
		return runRequest{}, errors.New("invalid_json")
	}

	if len(req.Files) == 0 {
		return runRequest{}, errors.New("missing_files")
	}

	seenPaths := make(map[string]struct{}, len(req.Files))
	var totalBytes int64
	for i := range req.Files {
		normalizedPath, err := normalizeWorkspacePath(req.Files[i].Path)
		if err != nil {
			return runRequest{}, err
		}

		if _, exists := seenPaths[normalizedPath]; exists {
			return runRequest{}, errors.New("duplicate_file_path")
		}
		seenPaths[normalizedPath] = struct{}{}

		req.Files[i].Path = normalizedPath
		totalBytes += int64(len([]byte(req.Files[i].Path)))
		totalBytes += int64(len([]byte(req.Files[i].Content)))
		if totalBytes > maxCodeBytes {
			return runRequest{}, errors.New("files_too_large")
		}
	}

	return req, nil
}

func normalizeWorkspacePath(raw string) (string, error) {
	pathValue := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if pathValue == "" {
		return "", errors.New("invalid_file_path")
	}

	cleaned := path.Clean(pathValue)
	switch {
	case cleaned == ".":
		return "", errors.New("invalid_file_path")
	case strings.HasPrefix(cleaned, "/"):
		return "", errors.New("invalid_file_path")
	case cleaned == "..":
		return "", errors.New("invalid_file_path")
	case strings.HasPrefix(cleaned, "../"):
		return "", errors.New("invalid_file_path")
	case !strings.HasSuffix(cleaned, ".go"):
		return "", errors.New("invalid_file_path")
	default:
		return cleaned, nil
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func runMain() int {
	cfg := loadConfig()

	if cfg.SharedSecret == "" {
		log.Print("WARN: RUNNER_SHARED_SECRET is not set; /internal/run will return 500")
	}

	warmGoCacheIfNeeded(cfg)

	s := &server{
		cfg:  cfg,
		exec: &dockerExecutor{cfg: cfg},
	}

	httpServer := &http.Server{
		Addr:              cfg.BindAddr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("runner listening on http://%s", cfg.BindAddr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("runner server error: %v", err)
		return 1
	}

	return 0
}
