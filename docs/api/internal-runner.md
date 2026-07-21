# Internal Runner API — `POST /internal/run`

## Purpose

Internal-only HTTP API exposed by the Go runner (localhost). Called by the Next.js app to compile + run a minimal Go workspace inside Docker.

The runner must not be publicly exposed when a safer localhost path is available.

## Network / access

- Default bind: `127.0.0.1:8081`
- Must require shared secret header:
  - `X-Runner-Secret: <RUNNER_SHARED_SECRET>`
- Missing/incorrect secret returns `401`.

## Request (JSON)

```json
{
  "files": [
    {
      "path": "main.go",
      "content": "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n"
    }
  ]
}
```

### Fields

- `files` (array, required): workspace files to write before running.
  - `path` (string, required): workspace-relative `.go` path such as `main.go` or `util/math/add.go`
  - `content` (string, required): Go source for that file

## Limits (MVP)

- Max request size: **512 KiB** of combined workspace source (`files`).
- Timeout: **3 seconds** total (compile + run).
- Output cap: **64 KiB** total (stdout+stderr combined).

## Operational notes

- The runner persists the Go build cache on the host via `RUNNER_HOST_CACHE_DIR` to keep execution fast.
- On a cold cache (fresh VPS install), the runner may take a while to warm the cache on startup before it begins
  accepting requests.

## Response (JSON, 200)

```json
{
  "stdout": "hi\n",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 12,
  "timed_out": false,
  "truncated": false,
  "internal_error": false
}
```

## Error responses

- `400` invalid request (missing code, too large)
- `401` missing/invalid shared secret
- `500` runner execution error (unexpected)

Note: Docker-unavailable errors are expected in some environments (e.g. local dev without Docker)
and should return `200` with `internal_error: true` and a helpful `stderr` message (host execution
remains forbidden).

## Execution constraints (MVP)

The runner must enforce:

- Docker execution (no host execution)
- `--network none`
- hard timeout (compile + run)
- output cap (stdout+stderr combined)
- resource limits (memory/cpu/pids) where practical
- generated module path `scratchpad` with `go run .` from the workspace root

See: `docs/features/runner.md`.
