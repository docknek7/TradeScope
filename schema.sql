-- Run once in Supabase SQL Editor. Enable email/password provider in Auth.
create table if not exists public.user_dashboards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_dashboards enable row level security;
create policy "read own dashboard" on public.user_dashboards for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own dashboard" on public.user_dashboards for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own dashboard" on public.user_dashboards for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No policy allowing anonymous or cross-account reads/writes.
