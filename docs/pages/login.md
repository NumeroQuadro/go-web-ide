# Login page (`/login`)

## Purpose

Provide a simple sign-in flow for the **single-user personal** hosted scratchpad using Supabase Auth.

## Route

- `GET /login`
- If the user is already authenticated, redirect to `/workbench`.

Note: this repo configures Next.js with `basePath: "/goofy-editor"`, so in production this page is reached at
`/goofy-editor/login`.

## UX requirements (MVP)

- Desktop-first layout.
- Single primary action: **Send magic link** (email OTP).
- Clear messaging about where the link is sent and what to do next.
- Visible loading state while requesting the magic link.
- Visible error state on failure (network, invalid email, rate limit).

## Auth method (MVP)

- Supabase Auth **email magic link** (OTP).
- Optional Google/GitHub sign-in buttons may be shown when those providers are configured in Supabase Auth.
- The page should request the magic link through a same-origin Next.js route, which then forwards the request to
  Supabase Auth.
- The app supports an **optional server-configured allowlist**:
  - `APP_ALLOWED_EMAILS` is a comma-separated list of allowed emails.
  - If set, users not in the allowlist must be signed out and denied access.

## Supabase configuration requirements

In the Supabase Dashboard, configure Auth URL settings so magic links land on the hosted app under
`/goofy-editor/` (this matters when the domain hosts multiple projects).

Go to **Authentication → URL Configuration** and set:

- **Site URL**:
  - `https://editor.example.com/goofy-editor`
- **Additional Redirect URLs** (minimum required):
  - `https://editor.example.com/goofy-editor/auth/callback`
  - (local dev) `http://localhost:3000/goofy-editor/auth/callback`

Notes:

- If you request a magic link while browsing `http://localhost:3000/...`, the email link will point to localhost.
  Request the magic link from the production site to get a production link.
- After changing Supabase URL settings, old emails still contain the old link; request a new magic link.
- The app uses a callback route at `/auth/callback` (implemented as `/goofy-editor/auth/callback` in production).
- Google/GitHub sign-in also redirect back through `/goofy-editor/auth/callback`, so the same callback URL must remain in the redirect allow list.
- The callback route exchanges an auth code for a session, so same-origin auth initiation routes must preserve Supabase
  PKCE cookies across the redirect.

## Social provider requirements

- To enable Google sign-in, turn on Google under **Authentication → Sign In / Providers** in Supabase and supply the Google OAuth client ID/secret described in the Supabase Google provider guide.
- To enable GitHub sign-in, turn on GitHub under **Authentication → Sign In / Providers** in Supabase and supply the GitHub OAuth app client ID/secret described in the Supabase GitHub provider guide.
- Until those provider credentials are configured in Supabase, provider buttons should fail with a clear message instead of a broken redirect.

## Environment variables

Browser-visible env names must be exactly:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
```

Server env:

```env
APP_ALLOWED_EMAILS=owner@example.com
APP_BASE_URL=https://editor.example.com/goofy-editor
```

## Acceptance criteria

- Visiting `/login` while signed out shows email + send-link UI.
- Clicking **Send magic link** should work even when the browser cannot make a direct third-party request to
  `*.supabase.co`, because the app uses its own same-origin route for the request.
- Clicking a social sign-in button should redirect through the app route and then into the provider consent flow when the provider is enabled in Supabase.
- Visiting `/login` while signed in redirects to `/workbench`.
- If `APP_ALLOWED_EMAILS` is set, signing in with an allowlisted email gives access to `/workbench`.
- If `APP_ALLOWED_EMAILS` is set, signing in with a non-allowlisted email results in immediate sign-out + “access denied”.
