-- V2 schema.sql must already exist. Additive migration, safe to reapply.
begin;
create table if not exists public.monitor_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (length(event_key) = 64),
  symbol text not null,
  signal text not null,
  label text not null,
  bar_at timestamptz not null,
  detected_at timestamptz not null default now(),
  price numeric not null check (price > 0),
  values jsonb not null,
  source text not null,
  timeframe text not null,
  unique(user_id, event_key)
);
create index if not exists monitor_events_history on public.monitor_events(user_id, bar_at desc, id desc);
create index if not exists monitor_events_symbol on public.monitor_events(user_id, symbol, bar_at desc, id desc);
create table if not exists public.monitor_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  config_hash text not null,
  revision bigint not null default 1,
  state jsonb not null,
  health jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, symbol)
);
alter table public.monitor_events enable row level security;
alter table public.monitor_state enable row level security;
drop policy if exists "read own monitoring events" on public.monitor_events;
create policy "read own monitoring events" on public.monitor_events for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "read own monitoring health" on public.monitor_state;
create policy "read own monitoring health" on public.monitor_state for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.monitor_events, public.monitor_state from anon, authenticated;
grant select on public.monitor_events, public.monitor_state to authenticated;
grant all on public.monitor_events, public.monitor_state to service_role;
grant usage, select on sequence public.monitor_events_id_seq to service_role;

-- State + events are committed together. Revision guards concurrent/manual runners.
create or replace function public.commit_monitor_batch(
  p_user uuid, p_symbol text, p_expected_revision bigint, p_config_hash text,
  p_state jsonb, p_health jsonb, p_events jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_symbol, 0));
  select revision into current_revision from public.monitor_state where user_id=p_user and symbol=p_symbol;
  if coalesce(current_revision, 0) <> p_expected_revision then
    raise exception 'monitor revision conflict' using errcode='40001';
  end if;
  insert into public.monitor_events(user_id,event_key,symbol,signal,label,bar_at,price,values,source,timeframe)
  select p_user,e.event_key,p_symbol,e.signal,e.label,e.bar_at,e.price,e.values,e.source,e.timeframe
  from jsonb_to_recordset(p_events) as e(event_key text,signal text,label text,bar_at timestamptz,price numeric,values jsonb,source text,timeframe text)
  on conflict(user_id,event_key) do nothing;
  insert into public.monitor_state(user_id,symbol,config_hash,revision,state,health)
  values(p_user,p_symbol,p_config_hash,p_expected_revision+1,p_state,p_health)
  on conflict(user_id,symbol) do update set config_hash=excluded.config_hash,
    revision=excluded.revision,state=excluded.state,health=excluded.health,updated_at=now();
end;
$$;
revoke all on function public.commit_monitor_batch(uuid,text,bigint,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.commit_monitor_batch(uuid,text,bigint,text,jsonb,jsonb,jsonb) to service_role;
commit;
