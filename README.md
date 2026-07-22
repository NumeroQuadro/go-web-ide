# Go Web IDE

[![CI](https://github.com/NumeroQuadro/go-web-ide/actions/workflows/ci.yml/badge.svg)](https://github.com/NumeroQuadro/go-web-ide/actions/workflows/ci.yml)

A self-hosted Go scratchpad for writing, saving, and running small Go programs from a browser.

The project combines a Next.js workbench, Supabase authentication and persistence, and a small Go service that executes code inside disposable Docker containers. The runner is designed to stay on a private loopback interface; only the web app is exposed through the reverse proxy.

## Features

- Monaco-based Go editor with optional Vim keybindings
- Multiple files and folders with persisted workspace state
- Passwordless Supabase authentication and an optional email allowlist
- Per-user data isolation through Supabase Row Level Security
- Captured stdout/stderr, duration, exit status, and timeout reporting
- Containerized execution with resource, output, and time limits
- Caddy and systemd templates for a single-server deployment

## Architecture

```text
Browser
  │
  ▼
Next.js web app ─────► Supabase Auth + Postgres
  │
  │ signed internal request
  ▼
Go runner ───────────► disposable Docker container
```

The web app lives at `/go-web-ide`. The runner listens on `127.0.0.1:8081` by default and must not be exposed directly to the internet.

## Quick start

Prerequisites: Node.js 24+, Go 1.22+, Docker, and a Supabase project.

1. Install the web dependencies and create a local environment file:

   ```bash
   npm ci
   cp .env.example .env.local
   ```

2. Fill in the Supabase URL and publishable key, then apply [`supabase/migrations/0001_scratchpad_schema.sql`](supabase/migrations/0001_scratchpad_schema.sql) to the project.

3. Start the internal runner in one terminal:

   ```bash
   cd runner
   RUNNER_SHARED_SECRET="$(openssl rand -hex 32)" go run ./cmd/runner
   ```

4. Put the same `RUNNER_SHARED_SECRET` in `.env.local`, then start the web app:

   ```bash
   npm run dev
   ```

5. Open <http://localhost:3000/go-web-ide>.

For authentication setup and production deployment, see [`docs/features/auth.md`](docs/features/auth.md) and [`docs/deployment/vps.md`](docs/deployment/vps.md).

## Configuration

All supported settings are documented in [`.env.example`](.env.example). Important values include:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- `APP_BASE_URL` and the optional `APP_ALLOWED_EMAILS`
- `RUNNER_INTERNAL_URL` and a long, random `RUNNER_SHARED_SECRET`
- runner bind address, Docker image, and host cache directory

Never commit `.env.local`, service-role keys, or production credentials.

## Verification

```bash
npm run lint
npm run typecheck
npm run build

cd runner
go test ./...
go build ./...
```

GitHub Actions runs the same web and runner checks on every push and pull request.

## Repository layout

```text
app/                    Next.js routes and workbench UI
lib/                    authentication, configuration, and persistence helpers
runner/                 internal Go execution service
supabase/migrations/    database schema and RLS policies
docs/                   feature, API, and deployment documentation
deploy/                 Caddy and systemd templates
```

## Security notes

Running untrusted code is inherently risky. Keep the runner bound to loopback, use a strong shared secret, keep Docker and the host patched, and review the resource limits before offering access to other users. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

This public edition contains example configuration only. It intentionally excludes credentials, deployment state, user data, and private project-management files.
