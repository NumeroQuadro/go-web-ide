# Feature — Runner (internal Go service + Docker execution)

## Summary

The runner is a separate Go service under `runner/` that executes **minimal multi-file Go workspaces** inside **Docker on the VPS**. It is not intended to be publicly reachable.

## Core constraints (non-negotiable)

- Never execute untrusted user code directly on the host.
- Use Docker isolation on the VPS runner side only.
- Disable container networking.
- Enforce timeout and output caps.
- The runner should be internal-only (localhost) if a safe internal path is available.

## Runner service (MVP)

### Location

- Code lives under `runner/` in this repo.

### Network binding

- Default bind address: `127.0.0.1:8081`
- Env:

```env
RUNNER_BIND_ADDR=127.0.0.1:8081
RUNNER_SHARED_SECRET=generate-a-long-random-secret
RUNNER_DOCKER_IMAGE=golang:1.22-alpine
RUNNER_HOST_CACHE_DIR=/tmp/goscratchpad-runner-cache
```

### Authentication (internal)

- Every request must include a shared secret header (example):
  - `X-Runner-Secret: <RUNNER_SHARED_SECRET>`
- Requests without the correct secret return `401`.

### Request shape

See `docs/api/internal-runner.md` for the concrete JSON contract.

## Docker execution requirements (MVP)

### High-level behavior

1. Runner receives a workspace file set.
2. Runner writes the files to a temporary directory on the VPS host (ephemeral).
3. Runner writes a generated `go.mod` with module path `scratchpad`.
4. Runner starts a Docker container to compile + run the workspace.
5. Runner captures stdout/stderr, applies caps, and returns results.

### Isolation settings (MVP baseline)

The container invocation should apply:

- `--rm` (cleanup)
- `--network none` (no networking)
- `--memory 256m`
- `--cpus 1`
- `--pids-limit 128`
- `--read-only` (read-only root filesystem)
- `--tmpfs /tmp:exec,size=64m` (allow compiler temp + cache)

Note: Go tooling needs writable temp/cache. If the root FS is read-only, set `TMPDIR`/`GOCACHE` into `/tmp`.

### Go build cache (host)

On Alpine-based images, the first `go run` often compiles large parts of the standard library, which can take a long
time on a small VPS. To keep subsequent executions within the MVP timeout:

- The runner sets `GOCACHE=/tmp/gocache` in the container.
- The runner bind-mounts a host directory to `/tmp/gocache` (default: `${RUNNER_HOST_CACHE_DIR}/gocache`) so the cache
  persists across runs.
- On a brand-new install (empty cache), the runner performs a one-time warmup compile at startup (writes a small marker
  file inside the cache dir when complete).

Deleting the host cache dir is safe, but will trigger another warmup on next runner start.

### Timeout and cancellation

- The runner must enforce a hard timeout for compilation + execution.
- MVP timeout: **3 seconds** total (compile + run).
- On timeout, the container must be terminated and the response must indicate `timed_out: true`.

### Output caps

- Cap total output size (stdout+stderr combined) to prevent abuse.
- MVP output cap: **64 KiB** total (stdout+stderr combined).
- When capped, set `truncated: true` and include the truncated output.

### Standard-library-oriented execution

- MVP is oriented around the Go standard library.
- The container must have networking disabled; therefore:
  - fetching arbitrary modules is not supported
  - third-party modules should fail compilation
- Set `GOPROXY=off`/`GOSUMDB=off` in the container to avoid module fetching even if host networking changes later.
- Local packages inside the workspace are supported through the fixed generated module path `scratchpad`.
- No UI for package management.

### Disclaimer

Docker isolation is a practical MVP boundary but is not claimed to be production-grade sandboxing.

## Next.js ↔ runner integration (MVP)

- Public web app calls `POST /api/run` (see `docs/api/public-run.md`).
- Next.js forwards the request to the runner over localhost:
  - URL from `RUNNER_INTERNAL_URL` (example: `http://127.0.0.1:8081`)
  - include shared secret header
- Runner should never be exposed directly to the public internet if a local path is available.

## Acceptance criteria

- Runner listens only on localhost by default.
- Runner rejects requests without shared secret.
- Runner executes snippets only inside Docker with networking disabled.
- Runner enforces timeout and output caps.

## Manual smoke test (local / VPS)

```bash
cd runner
go build -o /tmp/goscratchpad-runner ./cmd/runner

RUNNER_BIND_ADDR=127.0.0.1:8081 \
RUNNER_SHARED_SECRET=generate-a-long-random-secret \
RUNNER_DOCKER_IMAGE=golang:1.22-alpine \
RUNNER_HOST_CACHE_DIR=/tmp/goscratchpad-runner-cache \
/tmp/goscratchpad-runner
```

In another shell:

```bash
curl -sS http://127.0.0.1:8081/healthz && echo

curl -sS \
  -H 'X-Runner-Secret: generate-a-long-random-secret' \
  -H 'Content-Type: application/json' \
  -d '{"files":[{"path":"main.go","content":"package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"hi\") }\n"}]}' \
  http://127.0.0.1:8081/internal/run && echo
```

Notes:
- On a cold cache, the runner may spend a few minutes (depends on VPS size) warming the Go build cache before it starts listening.
- If Docker is unavailable, `/internal/run` returns `200` with `internal_error: true` (host execution remains forbidden).
