-- Study Lamp v2 schema — run this once in the Supabase SQL editor
-- (Dashboard → SQL Editor → paste → Run). Idempotent where practical.

-- ============================================================
-- Invite allowlist: only these emails may sign up.
-- Managed by the owner in Dashboard → Table Editor → allowed_emails.
-- ============================================================
create table if not exists public.allowed_emails (
  email text primary key,
  note text,
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- No policies and no grants on purpose: clients can never read or write
-- this table. Only the dashboard (postgres role) and the signup trigger
-- below touch it.

-- Reject any signup whose email is not on the allowlist. Runs inside the
-- auth service's insert, so it also guards direct calls to the auth API.
create or replace function public.enforce_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_emails a
    where lower(a.email) = lower(new.email)
  ) then
    raise exception 'Signups are invite-only. Ask the owner to add your email.';
  end if;
  return new;
end;
$$;
-- Trigger functions can't be called via RPC, but revoke anyway for hygiene.
revoke execute on function public.enforce_allowlist() from public, anon, authenticated;

drop trigger if exists enforce_allowlist_before_signup on auth.users;
create trigger enforce_allowlist_before_signup
  before insert on auth.users
  for each row execute function public.enforce_allowlist();

-- Friendly pre-check for the signup form (the trigger's exception surfaces
-- as an opaque "Database error saving new user" from the auth API).
-- SECURITY DEFINER so it can read the otherwise-inaccessible allowlist;
-- callable by anon by design — it only leaks whether an email is invited,
-- acceptable for a friends-and-family app.
create or replace function public.email_is_allowed(check_email text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.allowed_emails a
    where lower(a.email) = lower(check_email)
  );
$$;
grant execute on function public.email_is_allowed(text) to anon, authenticated;

-- ============================================================
-- Data tables (normalized-lite: entities as rows, flexible shapes as jsonb)
-- ============================================================
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  brief text not null default '',
  why_it_matters text not null default '',
  first_step text not null default '',
  roadmap jsonb not null default '[]'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  memory text not null default '',
  next_suggestion text not null default ''
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date timestamptz not null default now(),
  user_note text not null,
  companion_reply text not null default ''
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date timestamptz not null default now(),
  q text not null,
  a text not null default '',
  follow_up text not null default ''
);

create index if not exists journal_entries_topic_date on public.journal_entries (topic_id, date);
create index if not exists questions_topic_date on public.questions (topic_id, date);
create index if not exists topics_user_created on public.topics (user_id, created_at desc);

-- ============================================================
-- Row Level Security: each user sees only their own rows.
-- ============================================================
alter table public.topics enable row level security;
alter table public.journal_entries enable row level security;
alter table public.questions enable row level security;

-- topics
drop policy if exists "own topics select" on public.topics;
create policy "own topics select" on public.topics
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own topics insert" on public.topics;
create policy "own topics insert" on public.topics
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own topics update" on public.topics;
create policy "own topics update" on public.topics
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "own topics delete" on public.topics;
create policy "own topics delete" on public.topics
  for delete to authenticated using ((select auth.uid()) = user_id);

-- journal_entries
drop policy if exists "own journal select" on public.journal_entries;
create policy "own journal select" on public.journal_entries
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own journal insert" on public.journal_entries;
create policy "own journal insert" on public.journal_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own journal delete" on public.journal_entries;
create policy "own journal delete" on public.journal_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

-- questions
drop policy if exists "own questions select" on public.questions;
create policy "own questions select" on public.questions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own questions insert" on public.questions;
create policy "own questions insert" on public.questions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own questions delete" on public.questions;
create policy "own questions delete" on public.questions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ============================================================
-- Data API exposure. Since 2026-04, new tables in `public` are NOT
-- automatically exposed — grant explicitly, to authenticated only
-- (anon gets nothing; RLS above scopes the rows).
-- ============================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.topics to authenticated;
grant select, insert, delete on public.journal_entries to authenticated;
grant select, insert, delete on public.questions to authenticated;

-- ============================================================
-- Study Room (v3.0): per-topic library of articles/videos the learner
-- pastes in, plus the discussion threads about each item. Extracted
-- article text / transcripts live in library_items.content and are
-- fetched on demand, never with the topic load.
-- ============================================================
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('article', 'youtube')),
  url text not null,
  title text not null default '',
  site_name text,
  thumbnail text,
  status text not null default 'unread' check (status in ('unread', 'reading', 'done')),
  has_content boolean not null default false,
  content text not null default '',
  added_at timestamptz not null default now()
);

create table if not exists public.discussion_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.library_items (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date timestamptz not null default now(),
  role text not null check (role in ('user', 'companion')),
  text text not null default ''
);

create index if not exists library_items_topic_added on public.library_items (topic_id, added_at);
create index if not exists discussion_messages_item_date on public.discussion_messages (item_id, date);

alter table public.library_items enable row level security;
alter table public.discussion_messages enable row level security;

-- library_items (update is needed: status changes)
drop policy if exists "own library select" on public.library_items;
create policy "own library select" on public.library_items
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own library insert" on public.library_items;
create policy "own library insert" on public.library_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own library update" on public.library_items;
create policy "own library update" on public.library_items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "own library delete" on public.library_items;
create policy "own library delete" on public.library_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- discussion_messages
drop policy if exists "own discussion select" on public.discussion_messages;
create policy "own discussion select" on public.discussion_messages
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own discussion insert" on public.discussion_messages;
create policy "own discussion insert" on public.discussion_messages
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own discussion delete" on public.discussion_messages;
create policy "own discussion delete" on public.discussion_messages
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.library_items to authenticated;
grant select, insert, delete on public.discussion_messages to authenticated;

-- ============================================================
-- Seed the allowlist: replace with real emails (owner first!).
-- ============================================================
-- insert into public.allowed_emails (email, note) values
--   ('naseerspa@gmail.com', 'owner')
-- on conflict (email) do nothing;
