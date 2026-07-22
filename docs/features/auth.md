# Feature — Auth (Supabase)

## Summary

MVP authentication uses **Supabase Auth** and supports an optional allowlist via `APP_ALLOWED_EMAILS` for single-user personal deployments.

## Requirements (MVP)

- Supabase Auth is the only auth system.
- Supported sign-in methods may include email magic link and optional social providers such as Google or GitHub, as long as they are configured through Supabase Auth.
- Workbench access requires an authenticated session.
- Run endpoint access requires an authenticated session.
- If `APP_ALLOWED_EMAILS` is set, only allowlisted emails may use the app.

## Supabase URL configuration (required)

In the Supabase Dashboard, configure Auth URL settings to match the hosted base URL (including the base path):

- **Authentication → URL Configuration**
  - **Site URL**: set to `APP_BASE_URL` (example: `https://editor.example.com/go-web-ide`)
  - **Additional Redirect URLs**: include:
    - `https://editor.example.com/go-web-ide/auth/callback`
    - `http://localhost:3000/go-web-ide/auth/callback` (local dev)

If magic-link emails point to `http://localhost:3000/...`, Supabase is still configured for localhost (or the magic
link was requested while browsing localhost). Update the settings and request a new magic link.

## Allowlist enforcement

- Server env: `APP_ALLOWED_EMAILS`
  - comma-separated list of allowed emails (case-insensitive comparison recommended)
- Enforcement points:
  1. **Client/workbench entry**: if the logged-in user email is not allowlisted, immediately sign out and show “access denied”.
  2. **Server API (`/api/run`)**: validate the Supabase user and reject if not allowlisted.

Rationale: Supabase Auth may still allow an email to authenticate depending on provider settings; the app is responsible for restricting access.

## Supabase client usage

### Browser client

Used for:
- reading/writing tab + state data (RLS-protected)

Browser-visible env names must be exactly:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
```

### Server auth validation

`POST /api/run` must validate the caller as an authenticated Supabase user.

Chosen implementation:
- Cookie-based session using Supabase SSR helpers (`@supabase/ssr`) with request-level session refresh (Next.js middleware).

Secrets/admin keys must never be exposed to the browser bundle.

### Magic-link request path

- The login page should call a same-origin app route to request the magic link, and that route should forward the
  request to Supabase Auth.
- Rationale: the hosted app should not depend on every end-user browser being able to make a third-party request to
  `*.supabase.co` directly. A same-origin route avoids browser/network blockers surfacing as a generic fetch failure.
- The route should still use Supabase Auth as the only auth system and should preserve the hosted callback URL under
  `/go-web-ide/auth/callback`.
- Because the callback route exchanges an auth code for a cookie-backed session, same-origin auth routes must use the
  Supabase SSR client so PKCE state is persisted in cookies across the redirect.

### Social provider request path

- Social sign-in buttons may link to a same-origin app route which initiates `signInWithOAuth()` server-side and then redirects the browser to Supabase/Auth provider consent.
- The callback must still land on `/go-web-ide/auth/callback` so the app can exchange the returned code for a session and apply allowlist enforcement.
- When the app initiates social sign-in server-side, it must use the Supabase SSR client rather than a stateless
  client, otherwise the callback may return without an exchangeable auth code.
- Providers must be enabled in the Supabase Dashboard with their own client ID/secret before the buttons can succeed on production.

## Routes and behavior

- `/login`: sign-in UI (see `docs/pages/login.md`)
- `/workbench`: protected UI (see `docs/pages/workbench.md`)
- `/api/run`: protected API (see `docs/api/public-run.md`)

## Sign out

- Must provide a sign-out action in the workbench user menu.
- Sign-out clears Supabase session locally and redirects to `/login`.

## Acceptance criteria

- Signed-out user cannot access `/workbench` or `/api/run`.
- Allowlisted user can sign in and use the workbench.
- Non-allowlisted user is denied and cannot run code.
