-- Isolated PAPER-ONLY telemetry; no trading credentials, no broker execution.
create table if not exists public.pullback_paper_events (
  event_id text primary key,
  kind text not null,
  payload jsonb not null,
  inserted_at timestamptz not null default now()
);
alter table public.pullback_paper_events enable row level security;
-- No authenticated/anon policies: writes restricted to backend service role.
revoke all on public.pullback_paper_events from anon, authenticated;
create index if not exists pullback_paper_events_time_idx
  on public.pullback_paper_events (inserted_at desc);
