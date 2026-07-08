-- Run this once in Supabase → SQL Editor.
-- Stores each client (with its nested articles/audit/keywords) as a single JSONB row,
-- mirroring the exact shape the app already uses in localStorage.

create table if not exists seo_clients (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table seo_clients enable row level security;

-- Single-user tool behind its own login screen — anon key (with RLS) allows
-- read/write for anyone holding the key. Tighten this policy if you add
-- Supabase Auth per-user accounts later.
create policy "allow anon read/write" on seo_clients
  for all
  using (true)
  with check (true);
