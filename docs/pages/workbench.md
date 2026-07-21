# Workbench page (`/workbench`)

## Purpose

The workbench is the core authenticated UI: Monaco editor + tabs + Run + terminal/output panel, with server-backed autosave and cross-device restore.

## Route

- `GET /workbench`
- Must require authentication:
  - signed-out users are redirected to `/login`
  - non-allowlisted users are denied (see `docs/features/auth.md`)

Note: this repo configures Next.js with `basePath: "/goofy-editor"`, so in production this page is reached at
`/goofy-editor/workbench`.

## Layout (desktop-first)

- Top bar:
  - scrollable list of open file tabs
  - right-side utility controls:
    - **Run** as `▶`
    - low-emphasis save/sync status (Synced/Saving/Offline/Error)
    - Vim mode toggle (+ optional Vim status indicator)
    - account menu (email + sign out live inside the menu, not inline)
- Main area:
  - resizable left sidebar file explorer with:
    - `src/` folder containing each open tab as a file entry
    - file actions (rename/delete/reorder) available on hover
    - "New File" action at the bottom
  - Monaco editor occupying the majority of the viewport (right side)
- Bottom panel:
  - resizable (and collapsible) terminal-style output panel showing:
    - command prompt line (e.g. `$ go run .`)
    - stdout/stderr as a single stream (stderr styled as error)
    - exit code + duration + timeout/truncation/internal-error indicators

## Tabs model (MVP)

- Each tab is a Go file within the current workspace.
- A file path may include directories (for example `util/math/add.go`), and the explorer renders those directories implicitly from the path.
- Default root file: `main.go`.
- There is no separate folder table for MVP; directories exist only through file paths.
- The workspace has a fixed generated module path of `scratchpad`, so local packages are imported as `scratchpad/<dir>`.
- If the user deletes the last remaining file, the app must immediately provide a fresh replacement `main.go` file (never leave the workbench with zero files).

## Autosave behavior (MVP)

- Supabase is the source of truth for:
  - tab content
  - tab ordering / active tab (workbench state)
  - user settings (vim toggle)
- Browser writes should go through a same-origin Next.js workbench route, which then persists to Supabase server-side.
- Autosave should be debounced while typing (target: ~300ms–500ms).
- Autosave must also run on:
  - tab switch
  - before run (to avoid running stale code)
  - page hide/unload best-effort
- If a save fails (network / Supabase error), the UI must keep editing usable and surface a clear error state with an obvious retry path.

See: `docs/features/persistence.md`.

## Restore behavior (MVP)

On page load (after auth is confirmed):

1. The server-rendered workbench page loads user settings (vim mode preference).
2. The server-rendered workbench page loads workbench state (open tabs ordering + active tab).
   - Includes layout preferences (sidebar width, output height).
3. The server-rendered workbench page loads all referenced tabs (content + titles).
4. If no state exists yet, create a default state:
   - one file (`main.go`) with a minimal Go template
   - active tab set to that tab

Cross-device requirement: opening `/workbench` on a different device must restore the same server state.

## Run behavior (MVP)

- Primary action: **Run**.
- Invokes `POST /api/run` (Next.js) with the current workspace files.
- Must require authentication.
- The Next.js app forwards the run to the internal runner over localhost.
- The runner executes `go run .` from the workspace root.
- Update output panel with:
  - running state (spinner/text)
  - result (stdout/stderr, exit code, duration)
  - timeout / truncation indicators
  - internal/backend error indicator (runner unavailable or internal runner error)

See: `docs/api/public-run.md`, `docs/features/runner.md`, `docs/features/output-panel.md`.

## Keyboard shortcuts (recommended)

- `Ctrl+Enter` / `Cmd+Enter`: Run
- `Ctrl+S` / `Cmd+S`: Force save now (in addition to autosave)
- `Ctrl+Shift+P` / `Cmd+Shift+P`: Monaco command palette (built-in)

## Accessibility requirements

- Visible focus indicators for interactive controls.
- Run action must be reachable via keyboard.
- Respect `prefers-reduced-motion` (avoid unnecessary animations).

## Acceptance criteria

- Signed-in allowlisted user sees restored tabs and can edit.
- Code autosaves to Supabase and persists across refresh.
- State restores across devices (same user).
- Run calls `/api/run` and the terminal panel updates with results.
