-- Scratchpad schema (MVP)
-- Source of truth: docs/data/supabase-schema.md

create extension if not exists pgcrypto;

create table if not exists public.scratchpad_tabs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'main.go',
  content text not null default '',
  sort_index integer not null default 0,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scratchpad_tabs_user_sort_idx
  on public.scratchpad_tabs (user_id, sort_index);

create table if not exists public.scratchpad_workbench_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scratchpad_user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vim_mode_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.scratchpad_tabs enable row level security;
alter table public.scratchpad_workbench_state enable row level security;
alter table public.scratchpad_user_settings enable row level security;

drop policy if exists "tabs are owned by user" on public.scratchpad_tabs;
create policy "tabs are owned by user"
on public.scratchpad_tabs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "workbench state is owned by user" on public.scratchpad_workbench_state;
create policy "workbench state is owned by user"
on public.scratchpad_workbench_state
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user settings are owned by user" on public.scratchpad_user_settings;
create policy "user settings are owned by user"
on public.scratchpad_user_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
