-- Run in Supabase → SQL Editor. Safe to re-run: every statement is idempotent.

-- ── Agent data ──────────────────────────────────────────────────────────────
-- Each client (with its nested articles/audit/keywords) is one JSONB row,
-- mirroring the shape the app uses in localStorage.
create table if not exists seo_clients (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table seo_clients enable row level security;
-- Single-user tool behind its own login screen — the publishable key (with RLS)
-- allows read/write for anyone holding it. Tighten if you add per-user auth.
drop policy if exists "allow anon read/write" on seo_clients;
create policy "allow anon read/write" on seo_clients
  for all using (true) with check (true);

-- ── Client review links ─────────────────────────────────────────────────────
-- A snapshot of the article as sent to the client, plus their answer. Kept out
-- of seo_clients so the browser's full-row sync can't overwrite a response.
create table if not exists article_reviews (
  token text primary key,
  client_id text not null,
  article_id text not null,
  client_name text,
  title text not null,
  meta_description text,
  content text not null,
  featured_image text,
  status text not null default 'pending',
  comment text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table article_reviews enable row level security;
drop policy if exists "allow anon read/write" on article_reviews;
create policy "allow anon read/write" on article_reviews
  for all using (true) with check (true);

-- ── Article images ──────────────────────────────────────────────────────────
-- Public bucket: images are referenced directly from client sites.
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do update set public = true;
drop policy if exists "article-images upload" on storage.objects;
create policy "article-images upload" on storage.objects
  for insert to anon with check (bucket_id = 'article-images');
