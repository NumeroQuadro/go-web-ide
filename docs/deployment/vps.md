# Deployment — Single Ubuntu VPS (Caddy + Next.js + internal runner)

## Summary

Recommended MVP deployment is a single Ubuntu VPS running:

- **Caddy** (TLS termination + reverse proxy)
- **Next.js app** (localhost, e.g. `127.0.0.1:3000`)
- **Go runner** (localhost, e.g. `127.0.0.1:8081`)
- **Docker** (used by the runner only)

End users only need a browser. They do **not** need Docker.

Target base URL used in examples: `https://editor.example.com/goofy-editor/`.

## High-level architecture

```
Internet
  |
  v
Caddy (80/443)
  |
  v
Next.js (127.0.0.1:3000)  --->  Runner (127.0.0.1:8081)  --->  Docker container (no network)
  |
  v
Supabase (Auth + Postgres)
```

Important: this is **one VPS**. Caddy, the Next.js app, and the runner all run on the same host. Caddy only exposes the
Next.js app publicly; the runner stays on localhost.

## DNS / domain expectations

Before installing Caddy:

- Create DNS records pointing the domain to the VPS:
  - `A editor.example.com -> <VPS IPv4>`
  - (optional) `AAAA editor.example.com -> <VPS IPv6>`
- Ensure ports `80` and `443` are reachable from the internet (Caddy uses Let’s Encrypt).

## VPS prerequisites

- Ubuntu VPS with root or sudo access (22.04+ recommended)
- Domain configured (see above)
- Supabase project created

## 1) Install system packages

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates ufw
```

### Node.js (for Next.js)

Install Node.js LTS in a way that works with systemd (avoid `nvm` for services).

One common approach is NodeSource packages (choose an LTS version):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v
npm -v
```

### Go (for building the runner)

`runner/go.mod` uses Go `1.22`, so install Go `1.22+` on the VPS (example uses a `GO_VERSION` variable).

```bash
ARCH="$(dpkg --print-architecture)"   # amd64 or arm64
GO_VERSION="1.22.5"

cd /tmp
curl -fsSLO "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz"

sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf "go${GO_VERSION}.linux-${ARCH}.tar.gz"

echo 'export PATH=/usr/local/go/bin:$PATH' | sudo tee /etc/profile.d/go.sh >/dev/null
source /etc/profile.d/go.sh

go version
```

### Docker (required on the VPS for execution)

Docker is required **only** on the VPS runner side.

```bash
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
```

### Caddy (HTTPS + reverse proxy)

```bash
sudo apt-get install -y caddy || true
```

If your VPS image doesn’t have the `caddy` package available by default, install Caddy from the official repository:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy
```

Enable and start:

```bash
sudo systemctl enable --now caddy
```

## 2) Create a service user and deploy the repo

Recommended: run both services as a dedicated system user.

```bash
sudo adduser --system --group --home /srv/scratchpad scratchpad
sudo mkdir -p /srv/scratchpad
sudo chown scratchpad:scratchpad /srv/scratchpad
```

Deploy the repo to `/srv/scratchpad` (choose one method):

- Clone from git:

  ```bash
  sudo -u scratchpad git clone <YOUR_REPO_URL> /srv/scratchpad
  ```

- Or copy the repo to the VPS and ensure ownership:

  ```bash
  sudo chown -R scratchpad:scratchpad /srv/scratchpad
  ```

Allow the runner service to use Docker:

```bash
sudo usermod -aG docker scratchpad
# then log out/in (or reboot) so the group membership applies
```

## 3) Supabase setup (required)

- Create a Supabase project.
- Configure Auth:
  - enable email magic link (OTP) or chosen provider
  - configure URL settings (Authentication → URL Configuration):
    - **Site URL**: `https://editor.example.com/goofy-editor`
    - **Additional Redirect URLs**:
      - `https://editor.example.com/goofy-editor/auth/callback`
      - (optional local dev) `http://localhost:3000/goofy-editor/auth/callback`
- Apply the schema and RLS from `docs/data/supabase-schema.md`.

## 4) Environment files

Use two environment files (systemd loads them; Next.js also reads `.env` at build time):

Create the files with restricted permissions (they contain secrets):

```bash
sudo install -m 600 -o scratchpad -g scratchpad /dev/null /srv/scratchpad/.env
sudo install -m 600 -o scratchpad -g scratchpad /dev/null /srv/scratchpad/runner/.env
```

### Web app env: `/srv/scratchpad/.env`

```env
APP_BASE_URL=https://editor.example.com/goofy-editor
APP_ALLOWED_EMAILS=owner@example.com

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...

RUNNER_INTERNAL_URL=http://127.0.0.1:8081
RUNNER_SHARED_SECRET=generate-a-long-random-secret
```

### Runner env: `/srv/scratchpad/runner/.env`

```env
RUNNER_BIND_ADDR=127.0.0.1:8081
RUNNER_SHARED_SECRET=generate-a-long-random-secret
RUNNER_DOCKER_IMAGE=golang:1.22-alpine
RUNNER_HOST_CACHE_DIR=/tmp/goscratchpad-runner-cache
```

Important: `RUNNER_SHARED_SECRET` must match in both files.

## 5) Build the app + runner

Build the web app:

```bash
cd /srv/scratchpad
sudo -u scratchpad npm ci
sudo -u scratchpad npm run build
```

Build the runner binary:

```bash
cd /srv/scratchpad/runner
sudo -u scratchpad bash -lc 'source /etc/profile.d/go.sh && go build -o /srv/scratchpad/runner/runner ./cmd/runner'
```

## 6) systemd services

Copy the templates from the repo:

```bash
sudo cp /srv/scratchpad/deploy/systemd/scratchpad-web.service /etc/systemd/system/scratchpad-web.service
sudo cp /srv/scratchpad/deploy/systemd/scratchpad-runner.service /etc/systemd/system/scratchpad-runner.service

sudo systemctl daemon-reload
```

Start services:

```bash
sudo systemctl enable --now scratchpad-runner
sudo systemctl enable --now scratchpad-web
```

Notes:
- The runner service may spend a few minutes warming the Go build cache on first start (see `docs/features/runner.md`).
- If the runner fails to talk to Docker, re-check Docker installation and `scratchpad`’s membership in the `docker` group.

## Caddy configuration (example)

Install the repo template:

```bash
sudo cp /srv/scratchpad/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## If you deploy behind Nginx instead of Caddy

Supabase SSR auth can emit multiple `Set-Cookie` headers during `/auth/callback`. On Nginx, the default upstream
header buffer can be too small and cause `502 Bad Gateway` with `upstream sent too big header`.

For the app proxy locations, set larger proxy buffers, for example:

```nginx
proxy_buffer_size 32k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 64k;
```

Apply those directives to both the `/goofy-editor` and `/goofy-editor/` proxy locations, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

This Caddyfile only exposes the Next.js app publicly. The runner remains localhost-only.

## Nginx alternative (shared domain)

If you already run other projects on the same domain with Nginx, proxy only the `/goofy-editor/` path to the Next.js app.

Important: this app is built with Next.js `basePath: "/goofy-editor"`, so the proxy must **not** strip the prefix.
In Nginx that means the `proxy_pass` target should **not** end with a trailing slash.

Example snippet:

```nginx
location /goofy-editor/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Firewall guidance (ufw)

Only expose SSH + Caddy:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

Do not open ports `3000` or `8081` to the public internet.

## Logging / restart / troubleshooting

Tail logs:

```bash
sudo journalctl -u scratchpad-web -f
sudo journalctl -u scratchpad-runner -f
sudo journalctl -u caddy -f
```

## Resource monitoring (CPU / RAM)

Basic host overview:

```bash
free -h
df -h
uptime
```

Find the current PIDs:

```bash
sudo systemctl show -p MainPID --value scratchpad-web
sudo systemctl show -p MainPID --value scratchpad-runner
```

Check per-service usage (systemd cgroup):

```bash
sudo systemctl status scratchpad-web
sudo systemctl status scratchpad-runner
sudo systemd-cgtop
```

Check process-level CPU/RSS:

```bash
WEB_PID="$(sudo systemctl show -p MainPID --value scratchpad-web)"
RUNNER_PID="$(sudo systemctl show -p MainPID --value scratchpad-runner)"

ps -o pid,%cpu,%mem,rss,etime,cmd -p "$WEB_PID"
ps -o pid,%cpu,%mem,rss,etime,cmd -p "$RUNNER_PID"
```

Runner Docker activity:

```bash
sudo docker ps
sudo docker stats --no-stream
```

Restart services:

```bash
sudo systemctl restart scratchpad-runner
sudo systemctl restart scratchpad-web
sudo systemctl reload caddy
```

Check binding (both should be localhost-only):

```bash
ss -ltnp | rg ':3000|:8081' || true
```

## Update process (typical)

When updating code on the VPS:

```bash
cd /srv/scratchpad
sudo -u scratchpad git pull
sudo -u scratchpad npm ci
sudo -u scratchpad npm run build

cd /srv/scratchpad/runner
sudo -u scratchpad bash -lc 'source /etc/profile.d/go.sh && go build -o /srv/scratchpad/runner/runner ./cmd/runner'

sudo systemctl restart scratchpad-runner
sudo systemctl restart scratchpad-web
```

## Smoke checklist

- `https://editor.example.com/goofy-editor/login` loads and can send auth link.
- Signed-in allowlisted user can access `/workbench`.
- Tabs persist and restore after refresh.
- `Run` triggers `/api/run` and produces output.
