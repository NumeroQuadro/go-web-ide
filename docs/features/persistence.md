# Feature — Persistence (Supabase source of truth)

## Summary

All tab content and workbench/session state are persisted to **Supabase Postgres** and must restore across devices. Browser storage may exist only as a secondary resilience cache.

## Source of truth rules (MVP)

- Supabase is the **primary source of truth** for:
  - workspace file records (path + code content)
  - workbench state (open file ordering + active file)
  - user settings (vim mode preference)
- The browser should talk to the hosted app over same-origin routes, and the Next.js app should read/write Supabase server-side.
  This avoids browser/network blockers against `*.supabase.co` surfacing as generic fetch failures inside the workbench.
- Browser storage (e.g., `localStorage`) may be used only for:
  - temporary offline resilience (best-effort)
  - speeding up first paint while server loads (must reconcile with server)
- If server data exists, it wins.

## Data model (logical)

See `docs/data/supabase-schema.md` for concrete schema.

Conceptually:

- `scratchpad_tabs`: one row per workspace file
- `scratchpad_workbench_state`: one row per user (JSON state)
- `scratchpad_user_settings`: one row per user (vim toggle, future settings)

## Autosave semantics (MVP)

### Tab content

- Autosave is debounced while typing.
- Debounce target for MVP: ~300ms–500ms.
- A save writes to `scratchpad_tabs.content` and updates `updated_at`.
- The browser should call a same-origin workbench route, and that route should perform the Supabase write.
- Saves should be scoped to the active tab only (no bulk writes per keystroke).
- File paths are stored in `scratchpad_tabs.title` for the minimal workspace mode; directories are implicit from that path.

### Workbench state

Persist as a JSON blob owned by the user; at minimum:

```json
{
  "open_tab_ids": ["uuid-1", "uuid-2"],
  "active_tab_id": "uuid-1"
}
```

The implementation may extend this with editor UI state (panel sizes), but it must remain backward compatible.

Example extended shape (supported by this repo):

```json
{
  "open_tab_ids": ["uuid-1", "uuid-2"],
  "active_tab_id": "uuid-1",
  "layout": {
    "sidebar_width_px": 280,
    "output_height_px": 220,
    "output_split_percent": 55
  }
}
```

### Save triggers

Minimum triggers:
- debounce after edits
- on tab switch
- before run
- best-effort on page hide/unload

### Save failures (MVP)

- If Supabase writes fail (network / transient errors), the workbench must remain usable:
  - keep edits in-memory so the user can continue typing
  - surface a clear autosave error state
  - provide an obvious retry action for the active tab
- Optional local resilience cache is allowed, but it must remain secondary and be documented if added.

## Restore semantics (MVP)

On workbench entry:

1. The Next.js workbench page reads `scratchpad_user_settings` server-side (create defaults if missing).
2. The Next.js workbench page reads `scratchpad_workbench_state` server-side (create defaults if missing).
3. The Next.js workbench page reads all tabs referenced by the state.
4. If no files exist yet, create a default `main.go` file and corresponding state.

Cross-device requirement:
- The restored state must be the same on any device for the same user.

If Supabase returns “Could not find the table … in the schema cache”, the migration in
`supabase/migrations/0001_scratchpad_schema.sql` has not been applied to the configured project (or the schema cache
needs a reload).

## Conflict handling (MVP)

This is a single-user app, but multiple devices may be open.

- Default policy: **last write wins** (based on `updated_at`).
- It is acceptable for the MVP to overwrite changes when two devices type at once.
- If conflict handling is implemented later, prefer optimistic concurrency using a `revision` integer or Postgres `xmin` comparison.

## Resilience cache (optional, secondary)

- If used, the cache must be clearly treated as non-authoritative:
  - only used when Supabase is unavailable
  - reconciled with server when connectivity returns
- Cache should store:
  - latest active tab content
  - a timestamp
  - the last known server `updated_at` to detect staleness

## Security / access control

- All tables must have RLS enabled.
- Policies must enforce ownership (`auth.uid() = user_id`).

See: `docs/data/supabase-schema.md`.

## Acceptance criteria

- Tab content persists across refresh.
- Tabs + active tab restore across devices.
- Browser storage is not required to restore state and is never the primary source of truth.
