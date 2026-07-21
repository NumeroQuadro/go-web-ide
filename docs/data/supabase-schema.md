# Supabase schema (MVP)

## Summary

Supabase Postgres is the source of truth for:
- workspace file content
- workbench/session state (open files ordering + active file)
- user settings (vim mode)

All tables must have **RLS enabled** and must be safe to access using the browser publishable key.

## Tables

### `public.scratchpad_tabs`

One row per workspace file.

Suggested columns:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `user_id` | uuid | owner, references `auth.users(id)` |
| `title` | text | workspace-relative file path (default `main.go`) |
| `content` | text | Go source code |
| `sort_index` | int | ordering hint for the top tab bar |
| `deleted_at` | timestamptz | nullable soft delete |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

Recommended indexes:
- `(user_id, sort_index)`
- `(user_id) where deleted_at is null`

### `public.scratchpad_workbench_state`

Single row per user containing JSON state.

Suggested columns:

| column | type | notes |
|---|---|---|
| `user_id` | uuid | PK, references `auth.users(id)` |
| `state` | jsonb | `{ open_tab_ids: uuid[], active_tab_id: uuid }` |
| `updated_at` | timestamptz | default `now()` |

### `public.scratchpad_user_settings`

Single row per user containing user preferences.

Suggested columns:

| column | type | notes |
|---|---|---|
| `user_id` | uuid | PK, references `auth.users(id)` |
| `vim_mode_enabled` | boolean | default false |
| `updated_at` | timestamptz | default `now()` |

## Example SQL (illustrative)

```sql
create table public.scratchpad_tabs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'main.go',
  content text not null default '',
  sort_index integer not null default 0,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scratchpad_tabs_user_sort_idx
  on public.scratchpad_tabs (user_id, sort_index);

create table public.scratchpad_workbench_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.scratchpad_user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vim_mode_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
```

### `updated_at` maintenance

Implementation may use a trigger to keep `updated_at` current on updates, or it may set `updated_at = now()` in all update queries.

## RLS policies (required)

Enable RLS:

```sql
alter table public.scratchpad_tabs enable row level security;
alter table public.scratchpad_workbench_state enable row level security;
alter table public.scratchpad_user_settings enable row level security;
```

Ownership policies (illustrative):

```sql
create policy "tabs are owned by user"
on public.scratchpad_tabs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workbench state is owned by user"
on public.scratchpad_workbench_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user settings are owned by user"
on public.scratchpad_user_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## Notes

- The app is single-user, but the schema is still modeled as user-owned rows to keep RLS correct.
- Browser access must use:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- If you create/alter tables via SQL and the REST API returns “schema cache” errors, reload PostgREST’s schema cache:

  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
