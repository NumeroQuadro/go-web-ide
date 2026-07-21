package main

import "testing"

func TestBuildDockerRunArgs_HasSafetyFlags(t *testing.T) {
	args := buildDockerRunArgs("name", "golang:1.22-alpine", "/host/tmpdir", "/host/cache/gocache", containerUser{UID: 1000, GID: 1000})
	joined := make(map[string]bool, len(args))
	for _, a := range args {
		joined[a] = true
	}

	for _, want := range []string{
		"run",
		"--rm",
		"--network",
		"none",
		"--read-only",
		"--tmpfs",
		"--pids-limit",
		"128",
		"-e",
		"GOPROXY=off",
		"GOSUMDB=off",
		"/host/cache/gocache:/tmp/gocache:rw",
	} {
		if !joined[want] {
			t.Fatalf("missing %q in args: %#v", want, args)
		}
	}
}
