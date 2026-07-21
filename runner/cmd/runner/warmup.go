package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	goCacheWarmMarkerName = ".warmed"
	goCacheWarmupTimeout  = 5 * time.Minute
)

func warmGoCacheIfNeeded(cfg config) {
	if strings.TrimSpace(cfg.HostCacheDir) == "" {
		return
	}

	user := containerUserForHost()
	hostGoCacheDir, err := ensureHostGoCacheDir(cfg.HostCacheDir, user)
	if err != nil {
		log.Printf("runner cache warmup skipped (cache dir error): %v", err)
		return
	}

	markerPath := filepath.Join(hostGoCacheDir, goCacheWarmMarkerName)
	if _, err := os.Stat(markerPath); err == nil {
		return
	}

	log.Printf("warming Go build cache (this can take a while on first run)...")
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), goCacheWarmupTimeout)
	defer cancel()

	exec := &dockerExecutor{cfg: cfg}
	result := exec.Run(ctx, []workspaceFile{
		{
			Path:    "main.go",
			Content: "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"warm\") }\n",
		},
	})
	if result.InternalError {
		log.Printf("runner cache warmup failed: %s", strings.TrimSpace(result.Stderr))
		return
	}
	if result.TimedOut {
		log.Printf("runner cache warmup timed out after %s", time.Since(start))
		return
	}
	if result.ExitCode == nil || *result.ExitCode != 0 {
		log.Printf("runner cache warmup failed (exit=%v): %s", result.ExitCode, strings.TrimSpace(result.Stderr))
		return
	}

	if err := os.WriteFile(markerPath, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0o644); err != nil {
		log.Printf("runner cache warmup succeeded, but failed to write marker: %v", err)
		return
	}

	log.Printf("runner cache warmup complete in %s", time.Since(start))
}
