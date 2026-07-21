package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type dockerExecutor struct {
	cfg config
}

const generatedWorkspaceGoMod = `module scratchpad

go 1.22
`

func (e *dockerExecutor) Run(ctx context.Context, files []workspaceFile) execResult {
	_, err := exec.LookPath(e.cfg.DockerPath)
	if err != nil {
		return execResult{
			Stdout:        "",
			Stderr:        "docker is not available on this host (missing docker binary)\n",
			ExitCode:      nil,
			TimedOut:      false,
			Truncated:     false,
			InternalError: true,
		}
	}

	containerUser := containerUserForHost()

	hostGoCacheDir := ""
	if strings.TrimSpace(e.cfg.HostCacheDir) != "" {
		hostGoCacheDir, err = ensureHostGoCacheDir(e.cfg.HostCacheDir, containerUser)
		if err != nil {
			return execResult{
				Stdout:        "",
				Stderr:        fmt.Sprintf("internal runner error: failed to prepare host cache dir: %v\n", err),
				ExitCode:      nil,
				TimedOut:      false,
				Truncated:     false,
				InternalError: true,
			}
		}
	}

	tmpDir, err := os.MkdirTemp("", "goscratchpad-run-*")
	if err != nil {
		return execResult{
			Stdout:        "",
			Stderr:        "internal runner error: failed to create temp dir\n",
			ExitCode:      nil,
			TimedOut:      false,
			Truncated:     false,
			InternalError: true,
		}
	}
	defer os.RemoveAll(tmpDir)

	// We run containers as an unprivileged user. Make the host temp dir readable.
	_ = os.Chmod(tmpDir, 0o755)

	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte(generatedWorkspaceGoMod), 0o644); err != nil {
		return execResult{
			Stdout:        "",
			Stderr:        "internal runner error: failed to write go.mod\n",
			ExitCode:      nil,
			TimedOut:      false,
			Truncated:     false,
			InternalError: true,
		}
	}

	for _, file := range files {
		hostPath := filepath.Join(tmpDir, filepath.FromSlash(file.Path))
		if err := os.MkdirAll(filepath.Dir(hostPath), 0o755); err != nil {
			return execResult{
				Stdout:        "",
				Stderr:        fmt.Sprintf("internal runner error: failed to create workspace dir for %s\n", file.Path),
				ExitCode:      nil,
				TimedOut:      false,
				Truncated:     false,
				InternalError: true,
			}
		}

		if err := os.WriteFile(hostPath, []byte(file.Content), 0o644); err != nil {
			return execResult{
				Stdout:        "",
				Stderr:        fmt.Sprintf("internal runner error: failed to write %s\n", file.Path),
				ExitCode:      nil,
				TimedOut:      false,
				Truncated:     false,
				InternalError: true,
			}
		}
	}

	if _, err := os.Stat(filepath.Join(tmpDir, "main.go")); err != nil {
		return execResult{
			Stdout:        "",
			Stderr:        "workspace run requires a root main.go file in package main\n",
			ExitCode:      nil,
			TimedOut:      false,
			Truncated:     false,
			InternalError: true,
		}
	}

	containerName := fmt.Sprintf("goscratchpad-%d", time.Now().UnixNano())
	dockerArgs := buildDockerRunArgs(containerName, e.cfg.DockerImage, tmpDir, hostGoCacheDir, containerUser)

	stdoutBuf, stderrBuf, limit := newLimitedBuffers(e.cfg.MaxOutputBytes)
	cmd := exec.Command(e.cfg.DockerPath, dockerArgs...)
	cmd.Stdout = stdoutBuf
	cmd.Stderr = stderrBuf

	runCtx := ctx
	cancel := func() {}
	if _, ok := ctx.Deadline(); !ok {
		runCtx, cancel = context.WithTimeout(ctx, e.cfg.Timeout)
	}
	defer cancel()

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return execResult{
			Stdout:        "",
			Stderr:        "internal runner error: failed to start docker\n",
			ExitCode:      nil,
			TimedOut:      false,
			Truncated:     false,
			InternalError: true,
		}
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	timedOut := false
	var runErr error

	select {
	case runErr = <-done:
	case <-runCtx.Done():
		timedOut = errors.Is(runCtx.Err(), context.DeadlineExceeded)
		// Best-effort: kill the container even if the docker client gets stuck.
		_ = exec.Command(e.cfg.DockerPath, "rm", "-f", containerName).Run()
		select {
		case runErr = <-done:
		case <-time.After(500 * time.Millisecond):
			_ = cmd.Process.Kill()
			runErr = runCtx.Err()
		}
	}

	stdout := stdoutBuf.String()
	stderr := stderrBuf.String()
	truncated := limit.truncated

	if timedOut {
		return execResult{
			Stdout:        stdout,
			Stderr:        stderr,
			ExitCode:      nil,
			TimedOut:      true,
			Truncated:     truncated,
			InternalError: false,
		}
	}

	exitCode, internalErr := exitCodeFromErr(runErr, stderr)
	if internalErr {
		// Avoid leaking confusing docker exit codes; treat this as a runner issue.
		exitCode = nil
		if stderr == "" {
			stderr = "internal runner error: docker execution failed\n"
		}
	}

	// Ensure duration measurement is used (kept here for future per-run logs).
	_ = time.Since(start)

	return execResult{
		Stdout:        stdout,
		Stderr:        stderr,
		ExitCode:      exitCode,
		TimedOut:      false,
		Truncated:     truncated,
		InternalError: internalErr,
	}
}

type containerUser struct {
	UID int
	GID int
}

func containerUserForHost() containerUser {
	uid := os.Getuid()
	gid := os.Getgid()
	if uid == 0 {
		return containerUser{UID: 1000, GID: 1000}
	}
	return containerUser{UID: uid, GID: gid}
}

func ensureHostGoCacheDir(baseHostCacheDir string, user containerUser) (string, error) {
	absBase, err := filepath.Abs(baseHostCacheDir)
	if err != nil {
		return "", err
	}

	hostDir := filepath.Join(absBase, "gocache")
	if err := os.MkdirAll(hostDir, 0o755); err != nil {
		return "", err
	}

	// Allow the container user to write to the cache dir without requiring
	// the host process to run as that user.
	if os.Getuid() == 0 {
		if err := os.Chown(hostDir, user.UID, user.GID); err != nil {
			// As a fallback, make the directory world-writable. This runner is
			// intended for single-user personal deployments.
			_ = os.Chmod(hostDir, 0o777)
		}
	}

	return hostDir, nil
}

func buildDockerRunArgs(containerName, image, hostCodeDir, hostGoCacheDir string, user containerUser) []string {
	// NOTE: Keep flags minimal and explicit. This is MVP isolation, not a claim of
	// production-grade sandboxing.
	args := []string{
		"run",
		"--rm",
		"--name",
		containerName,
		"--network",
		"none",
		"--memory",
		"256m",
		"--cpus",
		"1",
		"--pids-limit",
		"128",
		"--read-only",
		"--tmpfs",
		"/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777",
		"--user",
		strconv.Itoa(user.UID) + ":" + strconv.Itoa(user.GID),
		"--workdir",
		"/src",
		"-v",
		fmt.Sprintf("%s:/src:ro", hostCodeDir),
	}

	if strings.TrimSpace(hostGoCacheDir) != "" {
		// Go on Alpine will compile the standard library on first run; persist
		// the build cache across runs to keep executions within the MVP timeout.
		args = append(args, "-v", fmt.Sprintf("%s:/tmp/gocache:rw", hostGoCacheDir))
	}

	args = append(args,
		"-e",
		"HOME=/tmp/home",
		"-e",
		"TMPDIR=/tmp",
		"-e",
		"GOTMPDIR=/tmp/gotmp",
		"-e",
		"GOCACHE=/tmp/gocache",
		"-e",
		"GOMODCACHE=/tmp/gomodcache",
		"-e",
		"GOPATH=/tmp/gopath",
		"-e",
		"GOPROXY=off",
		"-e",
		"GOSUMDB=off",
		"-e",
		"GO111MODULE=on",
		image,
		"sh",
		"-c",
		"mkdir -p /tmp/home /tmp/gotmp /tmp/gocache /tmp/gomodcache /tmp/gopath && /usr/local/go/bin/go run .",
	)

	return args
}

func exitCodeFromErr(err error, stderr string) (*int, bool) {
	if err == nil {
		code := 0
		return &code, false
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		// Docker itself uses 125 for its own failures.
		if code == 125 || looksLikeDockerDaemonError(stderr) {
			return &code, true
		}
		return &code, false
	}

	// Context cancellation that wasn't our timeout path.
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return nil, false
	}

	return nil, true
}

func looksLikeDockerDaemonError(stderr string) bool {
	s := strings.ToLower(stderr)
	return strings.Contains(s, "cannot connect to the docker daemon") ||
		strings.Contains(s, "is the docker daemon running") ||
		strings.Contains(s, "error during connect")
}
