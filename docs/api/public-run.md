# Public API — `POST /api/run`

## Purpose

Authenticated endpoint exposed by the Next.js app to run the current Go workspace. The Next.js app validates auth and forwards the request to the internal runner on localhost.

Note: this repo configures Next.js with `basePath: "/go-web-ide"`, so in production this endpoint is reached at
`POST /go-web-ide/api/run`.

## Auth

- Required.
- Must reject unauthenticated callers with `401`.
- Must reject non-allowlisted users with `403` (see `docs/features/auth.md`).

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

- `files` (array, required): workspace files to run.

## Limits (MVP)

- Max request size: **512 KiB** of combined workspace source (`files`).
- Runner timeout and output cap are enforced by the internal runner (see `docs/features/runner.md`).

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

### Fields

- `stdout` (string): captured standard output (possibly truncated)
- `stderr` (string): captured standard error (possibly truncated)
- `exit_code` (number|null): process exit code when available
- `duration_ms` (number): elapsed time (compile + run) in milliseconds
- `timed_out` (boolean): true if the run hit the runner timeout
- `truncated` (boolean): true if output caps were applied
- `internal_error` (boolean): true if the runner infrastructure failed (Docker unavailable, etc.)

## Errors

- `400` invalid request (missing/invalid files, duplicate paths, too large, request too large)
- `401` unauthenticated
- `403` authenticated but not allowlisted
- `502` runner unavailable / unreachable / timed out
- `500` internal error

Note: Some runner-side failures are surfaced as `200` with `internal_error: true`
(host execution remains forbidden).

## Forwarding to internal runner

The Next.js app forwards the request to the internal runner:

- URL: `RUNNER_INTERNAL_URL` (example: `http://127.0.0.1:8081`)
- Header: `X-Runner-Secret: <RUNNER_SHARED_SECRET>`

See: `docs/api/internal-runner.md`.
