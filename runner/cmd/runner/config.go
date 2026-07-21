package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	BindAddr string

	SharedSecret string

	DockerImage string
	DockerPath  string

	HostCacheDir string

	MaxCodeBytes   int64
	MaxOutputBytes int
	Timeout        time.Duration
}

const (
	defaultBindAddr = "127.0.0.1:8081"
	defaultTimeout  = 3 * time.Second

	// MVP limits. Keep these values aligned with docs.
	defaultMaxCodeBytes   = 512 * 1024
	defaultMaxOutputBytes = 64 * 1024

	defaultDockerImage = "golang:1.22-alpine"
	defaultDockerPath  = "docker"

	defaultHostCacheDir = "/tmp/goscratchpad-runner-cache"
)

func loadConfig() config {
	cfg := config{
		BindAddr:       defaultBindAddr,
		SharedSecret:   strings.TrimSpace(os.Getenv("RUNNER_SHARED_SECRET")),
		DockerImage:    defaultDockerImage,
		DockerPath:     defaultDockerPath,
		HostCacheDir:   defaultHostCacheDir,
		MaxCodeBytes:   defaultMaxCodeBytes,
		MaxOutputBytes: defaultMaxOutputBytes,
		Timeout:        defaultTimeout,
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_BIND_ADDR")); v != "" {
		cfg.BindAddr = v
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_DOCKER_IMAGE")); v != "" {
		cfg.DockerImage = v
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_DOCKER_PATH")); v != "" {
		cfg.DockerPath = v
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_HOST_CACHE_DIR")); v != "" {
		cfg.HostCacheDir = v
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_TIMEOUT_MS")); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			cfg.Timeout = time.Duration(ms) * time.Millisecond
		}
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_MAX_CODE_BYTES")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			cfg.MaxCodeBytes = n
		}
	}

	if v := strings.TrimSpace(os.Getenv("RUNNER_MAX_OUTPUT_BYTES")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.MaxOutputBytes = n
		}
	}

	return cfg
}
