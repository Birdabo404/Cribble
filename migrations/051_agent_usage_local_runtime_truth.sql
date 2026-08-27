-- Local-runtime event facts preserve unknown token classes as NULL.
-- The API deliberately sends these fields through p_records; this migration
-- makes their storage explicit without converting absence into numeric zero.
alter table public.agent_usage_events
  alter column cache_creation_tokens drop not null,
  alter column cache_read_tokens drop not null,
  add column if not exists request_id text,
  add column if not exists provider text,
  add column if not exists runtime text,
  add column if not exists reasoning_tokens bigint,
  add column if not exists provenance text[] not null default '{}';

alter table public.agent_usage_events
  drop constraint if exists agent_usage_events_reasoning_tokens_check;
alter table public.agent_usage_events
  add constraint agent_usage_events_reasoning_tokens_check
  check (reasoning_tokens is null or reasoning_tokens between 0 and 1000000000000);

comment on column public.agent_usage_events.cache_creation_tokens is
  'NULL means the source did not report this class; zero means authoritative known zero.';
comment on column public.agent_usage_events.cache_read_tokens is
  'NULL means the source did not report this class; zero means authoritative known zero.';
comment on column public.agent_usage_events.reasoning_tokens is
  'NULL means the source did not report this class; zero means authoritative known zero.';
