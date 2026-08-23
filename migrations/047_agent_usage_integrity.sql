-- ============================================================
-- Migration 047: Agent usage integrity and exact attribution
-- ============================================================
-- Keeps schema-v1 daily snapshots compatible while adding:
--   * expiring keys and transaction-safe key caps
--   * a named client registry associated with the last key used
--   * an event-level v2 fact table for exact timezone rebucketing and
--     token-weighted agent/model attribution
--   * one atomic ingest RPC for client caps and stale-write arbitration
--   * bounded six-decimal cost storage and bounded new token facts
--   * numeric (not bigint-cast) public aggregates
--
-- All raw tables and mutation RPCs remain service-role only.
-- ============================================================

-- ----------------------------------------------------------------
-- Expiring keys and bounded legacy facts
-- ----------------------------------------------------------------

alter table public.agent_api_keys
  add column if not exists expires_at timestamptz;

update public.agent_api_keys
set expires_at = greatest(created_at + interval '180 days', now() + interval '30 days')
where expires_at is null;

alter table public.agent_api_keys
  alter column expires_at set default (now() + interval '90 days'),
  alter column expires_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'agent_api_keys_expiration_ordered'
      and conrelid = 'public.agent_api_keys'::regclass
  ) then
    alter table public.agent_api_keys
      add constraint agent_api_keys_expiration_ordered
      check (expires_at > created_at);
  end if;
end
$$;

comment on column public.agent_api_keys.expires_at is
  'Hard expiry for this bearer credential. New keys default to 90 days and may request 7-365 days.';

-- Preserve a generous integer range for historical self-reported costs, but
-- make the promised six-decimal scale real. New writes are capped lower by
-- both the API and ingest RPC.
alter table public.agent_usage_daily
  alter column cost_usd type numeric(30, 6)
    using round(cost_usd, 6);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'agent_usage_daily_new_fact_bounds'
      and conrelid = 'public.agent_usage_daily'::regclass
  ) then
    -- NOT VALID avoids blocking deployment on old self-reported anomalies,
    -- while PostgreSQL still enforces the constraint for every new write.
    alter table public.agent_usage_daily
      add constraint agent_usage_daily_new_fact_bounds
      check (
        input_tokens <= 1000000000000
        and output_tokens <= 1000000000000
        and cache_creation_tokens <= 1000000000000
        and cache_read_tokens <= 1000000000000
        and total_tokens <= 1000000000000
        and cost_usd <= 1000000
      ) not valid;
  end if;
end
$$;

-- ----------------------------------------------------------------
-- Named clients and event-level v2 facts
-- ----------------------------------------------------------------

create table if not exists public.agent_usage_clients (
  user_id integer not null references public.users(id) on delete cascade,
  client_id uuid not null,
  machine_name text not null
    constraint agent_usage_clients_machine_name_length
      check (btrim(machine_name) <> '' and char_length(machine_name) <= 80),
  last_key_id bigint references public.agent_api_keys(id) on delete set null,
  timezone text
    constraint agent_usage_clients_timezone_length
      check (timezone is null or char_length(timezone) between 1 and 64),
  schema_version smallint not null default 1
    constraint agent_usage_clients_schema_version check (schema_version in (1, 2)),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, client_id),
  constraint agent_usage_clients_seen_ordered check (last_seen_at >= first_seen_at)
);

comment on table public.agent_usage_clients is
  'One row per installed Agent client. Stores a meaningful machine name and the last API key used without exposing raw usage.';
comment on column public.agent_usage_clients.last_key_id is
  'Last Agent key used by this client, allowing the client to be associated with its user-visible key label.';

-- Backfill the registry without inventing a key association. A future ingest
-- replaces the fallback with the supplied machine name or active key label.
insert into public.agent_usage_clients (
  user_id,
  client_id,
  machine_name,
  timezone,
  schema_version,
  first_seen_at,
  last_seen_at
)
select
  usage.user_id,
  usage.client_id,
  'Client ' || left(usage.client_id::text, 8),
  (array_agg(usage.timezone order by usage.ingested_at desc)
    filter (where usage.timezone is not null))[1],
  1,
  min(usage.ingested_at),
  max(usage.ingested_at)
from public.agent_usage_daily as usage
group by usage.user_id, usage.client_id
on conflict (user_id, client_id) do nothing;

create index if not exists idx_agent_usage_clients_last_key
  on public.agent_usage_clients(last_key_id)
  where last_key_id is not null;

create table if not exists public.agent_usage_events (
  id bigserial primary key,
  user_id integer not null references public.users(id) on delete cascade,
  client_id uuid not null,
  event_id text not null
    constraint agent_usage_events_event_id_length
      check (btrim(event_id) <> '' and char_length(event_id) <= 128),
  occurred_at timestamptz not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_creation_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  cost_usd numeric(30, 6) not null default 0,
  agent text not null
    constraint agent_usage_events_agent_length
      check (btrim(agent) <> '' and char_length(agent) <= 128),
  model text not null
    constraint agent_usage_events_model_length
      check (btrim(model) <> '' and char_length(model) <= 128),
  timezone text not null
    constraint agent_usage_events_timezone_length
      check (char_length(timezone) between 1 and 64),
  source text not null default 'ccusage'
    constraint agent_usage_events_source_supported check (source = 'ccusage'),
  cli_version text not null
    constraint agent_usage_events_cli_version_length
      check (char_length(cli_version) between 1 and 64),
  generated_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  constraint agent_usage_events_user_client_fkey
    foreign key (user_id, client_id)
    references public.agent_usage_clients(user_id, client_id)
    on delete cascade,
  constraint agent_usage_events_total_matches_parts
    check (
      total_tokens = input_tokens + output_tokens
        + cache_creation_tokens + cache_read_tokens
    ),
  constraint agent_usage_events_fact_bounds
    check (
      input_tokens between 0 and 1000000000000
      and output_tokens between 0 and 1000000000000
      and cache_creation_tokens between 0 and 1000000000000
      and cache_read_tokens between 0 and 1000000000000
      and total_tokens between 0 and 1000000000000
      and cost_usd between 0 and 1000000
    ),
  constraint agent_usage_events_user_client_event_key
    unique (user_id, client_id, event_id)
);

comment on table public.agent_usage_events is
  'Schema-v2 token facts with exact occurrence timestamps and one agent/model per fact, enabling viewer-timezone buckets and token-weighted breakdowns.';

create index if not exists idx_agent_usage_events_user_occurred
  on public.agent_usage_events(user_id, occurred_at);
create index if not exists idx_agent_usage_events_user_agent
  on public.agent_usage_events(user_id, agent);
create index if not exists idx_agent_usage_events_user_model
  on public.agent_usage_events(user_id, model);

alter table public.agent_usage_clients enable row level security;
alter table public.agent_usage_events enable row level security;

revoke all on table public.agent_usage_clients from public, anon, authenticated;
revoke all on table public.agent_usage_events from public, anon, authenticated;
revoke all on sequence public.agent_usage_events_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.agent_usage_clients to service_role;
grant select, insert, update, delete on table public.agent_usage_events to service_role;
grant usage, select on sequence public.agent_usage_events_id_seq to service_role;

comment on column public.agent_usage_sharing.leaderboard_enabled is
  'True only after the user explicitly agrees to publish identity, aggregate token totals, estimated cost, and agent/model breakdowns. Raw events and machine details remain private.';

comment on table public.staff_rate_limits is
  'Atomic cross-instance rate-limit counters for authenticated staff and Agent ingestion scopes. Keys are one-way hashed by the server.';

alter table public.agent_usage_sharing
  add column if not exists consent_version smallint not null default 1
    constraint agent_usage_sharing_consent_version_positive
      check (consent_version > 0);

-- Version 2 publishes token-weighted agent/model breakdowns in addition to
-- the original totals. Require an explicit opt-in to that expanded surface.
update public.agent_usage_sharing
set
  leaderboard_enabled = false,
  enabled_at = null,
  updated_at = now()
where leaderboard_enabled
  and consent_version < 2;

comment on column public.agent_usage_sharing.consent_version is
  'Disclosure version accepted by the owner. Version 2 includes aggregate agent/model token breakdowns.';

-- ----------------------------------------------------------------
-- Transaction-safe key creation
-- ----------------------------------------------------------------

create or replace function public.create_agent_api_key(
  p_user_id integer,
  p_key_hash text,
  p_key_prefix text,
  p_label text,
  p_expires_at timestamptz
)
returns table (
  id bigint,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_active_count integer;
begin
  if p_user_id is null or p_user_id <= 0 then
    raise exception 'agent_invalid_user' using errcode = '22023';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$'
    or p_key_prefix !~ '^crib_ag_[0-9a-f]{4}$'
    or btrim(coalesce(p_label, '')) = ''
    or char_length(p_label) > 40
  then
    raise exception 'agent_invalid_key' using errcode = '22023';
  end if;
  if p_expires_at <= v_now + interval '6 days'
    or p_expires_at > v_now + interval '365 days 1 hour'
  then
    raise exception 'agent_invalid_key_expiry' using errcode = '22023';
  end if;

  -- Serializes count + insert for this owner, closing the five-key race.
  perform 1
  from public.users as owner
  where owner.id = p_user_id
  for update;
  if not found then
    raise exception 'agent_invalid_user' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_active_count
  from public.agent_api_keys as keys
  where keys.user_id = p_user_id
    and keys.revoked_at is null
    and keys.expires_at > v_now;

  if v_active_count >= 5 then
    raise exception 'agent_key_limit' using errcode = 'P0001';
  end if;

  return query
  insert into public.agent_api_keys (
    user_id,
    key_hash,
    key_prefix,
    label,
    expires_at
  )
  values (
    p_user_id,
    p_key_hash,
    p_key_prefix,
    btrim(p_label),
    p_expires_at
  )
  returning
    agent_api_keys.id,
    agent_api_keys.created_at,
    agent_api_keys.expires_at;
end;
$$;

revoke all on function public.create_agent_api_key(
  integer, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_agent_api_key(
  integer, text, text, text, timestamptz
) to service_role;

-- ----------------------------------------------------------------
-- Atomic client registration + stale-safe v1/v2 ingest
-- ----------------------------------------------------------------

create or replace function public.ingest_agent_usage(
  p_user_id integer,
  p_key_id bigint,
  p_client_id uuid,
  p_machine_name text,
  p_timezone text,
  p_source text,
  p_cli_version text,
  p_generated_at timestamptz,
  p_schema_version smallint,
  p_records jsonb
)
returns table (
  inserted bigint,
  replaced bigint,
  stale bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key_label text;
  v_client_exists boolean;
  v_client_schema smallint;
  v_client_count integer;
  v_machine_name text;
  v_record_count integer;
  v_generated_date date;
  v_inserted bigint := 0;
  v_replaced bigint := 0;
  v_stale bigint := 0;
begin
  if p_user_id is null or p_user_id <= 0 or p_client_id is null then
    raise exception 'agent_invalid_owner' using errcode = '22023';
  end if;
  if p_schema_version not in (1, 2) then
    raise exception 'agent_invalid_schema' using errcode = '22023';
  end if;
  if p_source <> 'ccusage'
    or char_length(coalesce(p_cli_version, '')) not between 1 and 64
  then
    raise exception 'agent_invalid_provenance' using errcode = '22023';
  end if;
  if p_generated_at < v_now - interval '7 days'
    or p_generated_at > v_now + interval '1 hour'
  then
    raise exception 'agent_invalid_generated_at' using errcode = '22023';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'agent_invalid_records' using errcode = '22023';
  end if;

  v_record_count := jsonb_array_length(p_records);
  if (p_schema_version = 1 and v_record_count not between 1 and 365)
    or (p_schema_version = 2 and v_record_count not between 1 and 2000)
  then
    raise exception 'agent_invalid_record_count' using errcode = '22023';
  end if;

  if p_timezone is not null and not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_timezone
  ) then
    raise exception 'agent_invalid_timezone' using errcode = '22023';
  end if;
  if p_schema_version = 2 and p_timezone is null then
    raise exception 'agent_invalid_timezone' using errcode = '22023';
  end if;

  -- Every ingest for one owner takes the same short row lock. This makes
  -- both the 10-client cap and the before/after write counts race-free.
  perform 1
  from public.users as owner
  where owner.id = p_user_id
  for update;
  if not found then
    raise exception 'agent_key_invalid' using errcode = 'P0001';
  end if;

  select keys.label
  into v_key_label
  from public.agent_api_keys as keys
  where keys.id = p_key_id
    and keys.user_id = p_user_id
    and keys.revoked_at is null
    and keys.expires_at > v_now
  for update;
  if not found then
    raise exception 'agent_key_invalid' using errcode = 'P0001';
  end if;

  v_machine_name := coalesce(nullif(btrim(p_machine_name), ''), v_key_label);
  if char_length(v_machine_name) not between 1 and 80 then
    raise exception 'agent_invalid_machine_name' using errcode = '22023';
  end if;

  select true, clients.schema_version
  into v_client_exists, v_client_schema
  from public.agent_usage_clients as clients
  where clients.user_id = p_user_id
    and clients.client_id = p_client_id;

  if not coalesce(v_client_exists, false) then
    select count(*)::integer
    into v_client_count
    from public.agent_usage_clients as clients
    where clients.user_id = p_user_id;

    if v_client_count >= 10 then
      raise exception 'agent_client_limit' using errcode = 'P0001';
    end if;

    insert into public.agent_usage_clients (
      user_id,
      client_id,
      machine_name,
      last_key_id,
      timezone,
      schema_version,
      first_seen_at,
      last_seen_at
    )
    values (
      p_user_id,
      p_client_id,
      v_machine_name,
      p_key_id,
      p_timezone,
      p_schema_version,
      v_now,
      v_now
    );
  else
    if v_client_schema = 2 and p_schema_version = 1 then
      raise exception 'agent_invalid_schema_downgrade' using errcode = '22023';
    end if;

    update public.agent_usage_clients as clients
    set
      machine_name = v_machine_name,
      last_key_id = p_key_id,
      timezone = coalesce(p_timezone, clients.timezone),
      schema_version = greatest(clients.schema_version, p_schema_version),
      last_seen_at = v_now
    where clients.user_id = p_user_id
      and clients.client_id = p_client_id;
  end if;

  if p_schema_version = 1 then
    v_generated_date := (
      p_generated_at at time zone coalesce(p_timezone, 'UTC')
    )::date;

    if exists (
      select 1
      from jsonb_to_recordset(p_records) as record (
        date date,
        input_tokens bigint,
        output_tokens bigint,
        cache_creation_tokens bigint,
        cache_read_tokens bigint,
        total_tokens bigint,
        cost_usd numeric,
        agents text[],
        models text[]
      )
      where record.date > v_generated_date
        or record.date < v_generated_date - 364
        or record.input_tokens not between 0 and 1000000000000
        or record.output_tokens not between 0 and 1000000000000
        or record.cache_creation_tokens not between 0 and 1000000000000
        or record.cache_read_tokens not between 0 and 1000000000000
        or record.total_tokens not between 0 and 1000000000000
        or record.total_tokens <> record.input_tokens + record.output_tokens
          + record.cache_creation_tokens + record.cache_read_tokens
        or record.cost_usd not between 0 and 1000000
        or cardinality(record.agents) > 32
        or cardinality(record.models) > 32
    ) then
      raise exception 'agent_invalid_daily_fact' using errcode = '22023';
    end if;

    select
      count(*) filter (where existing.id is null),
      count(*) filter (
        where existing.id is not null
          and existing.generated_at < p_generated_at
      ),
      count(*) filter (
        where existing.id is not null
          and existing.generated_at >= p_generated_at
      )
    into v_inserted, v_replaced, v_stale
    from jsonb_to_recordset(p_records) as record (date date)
    left join public.agent_usage_daily as existing
      on existing.user_id = p_user_id
     and existing.client_id = p_client_id
     and existing.date = record.date;

    insert into public.agent_usage_daily as current_usage (
      user_id,
      client_id,
      date,
      input_tokens,
      output_tokens,
      cache_creation_tokens,
      cache_read_tokens,
      total_tokens,
      cost_usd,
      agents,
      models,
      timezone,
      source,
      cli_version,
      generated_at,
      ingested_at
    )
    select
      p_user_id,
      p_client_id,
      record.date,
      record.input_tokens,
      record.output_tokens,
      record.cache_creation_tokens,
      record.cache_read_tokens,
      record.total_tokens,
      round(record.cost_usd, 6),
      record.agents,
      record.models,
      p_timezone,
      p_source,
      p_cli_version,
      p_generated_at,
      v_now
    from jsonb_to_recordset(p_records) as record (
      date date,
      input_tokens bigint,
      output_tokens bigint,
      cache_creation_tokens bigint,
      cache_read_tokens bigint,
      total_tokens bigint,
      cost_usd numeric,
      agents text[],
      models text[]
    )
    on conflict (user_id, client_id, date) do update
    set
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      agents = excluded.agents,
      models = excluded.models,
      timezone = excluded.timezone,
      source = excluded.source,
      cli_version = excluded.cli_version,
      generated_at = excluded.generated_at,
      ingested_at = excluded.ingested_at
    where current_usage.generated_at < excluded.generated_at;
  else
    if exists (
      select 1
      from jsonb_to_recordset(p_records) as record (
        event_id text,
        occurred_at timestamptz,
        agent text,
        model text,
        input_tokens bigint,
        output_tokens bigint,
        cache_creation_tokens bigint,
        cache_read_tokens bigint,
        total_tokens bigint,
        cost_usd numeric
      )
      where btrim(coalesce(record.event_id, '')) = ''
        or char_length(record.event_id) > 128
        or record.occurred_at < p_generated_at - interval '365 days'
        or record.occurred_at > p_generated_at + interval '1 hour'
        or btrim(coalesce(record.agent, '')) = ''
        or char_length(record.agent) > 128
        or btrim(coalesce(record.model, '')) = ''
        or char_length(record.model) > 128
        or record.input_tokens not between 0 and 1000000000000
        or record.output_tokens not between 0 and 1000000000000
        or record.cache_creation_tokens not between 0 and 1000000000000
        or record.cache_read_tokens not between 0 and 1000000000000
        or record.total_tokens not between 0 and 1000000000000
        or record.total_tokens <> record.input_tokens + record.output_tokens
          + record.cache_creation_tokens + record.cache_read_tokens
        or record.cost_usd not between 0 and 1000000
    ) then
      raise exception 'agent_invalid_event_fact' using errcode = '22023';
    end if;

    select
      count(*) filter (where existing.id is null),
      count(*) filter (
        where existing.id is not null
          and existing.generated_at < p_generated_at
      ),
      count(*) filter (
        where existing.id is not null
          and existing.generated_at >= p_generated_at
      )
    into v_inserted, v_replaced, v_stale
    from jsonb_to_recordset(p_records) as record (event_id text)
    left join public.agent_usage_events as existing
      on existing.user_id = p_user_id
     and existing.client_id = p_client_id
     and existing.event_id = record.event_id;

    insert into public.agent_usage_events as current_usage (
      user_id,
      client_id,
      event_id,
      occurred_at,
      input_tokens,
      output_tokens,
      cache_creation_tokens,
      cache_read_tokens,
      total_tokens,
      cost_usd,
      agent,
      model,
      timezone,
      source,
      cli_version,
      generated_at,
      ingested_at
    )
    select
      p_user_id,
      p_client_id,
      record.event_id,
      record.occurred_at,
      record.input_tokens,
      record.output_tokens,
      record.cache_creation_tokens,
      record.cache_read_tokens,
      record.total_tokens,
      round(record.cost_usd, 6),
      lower(btrim(record.agent)),
      lower(btrim(record.model)),
      p_timezone,
      p_source,
      p_cli_version,
      p_generated_at,
      v_now
    from jsonb_to_recordset(p_records) as record (
      event_id text,
      occurred_at timestamptz,
      agent text,
      model text,
      input_tokens bigint,
      output_tokens bigint,
      cache_creation_tokens bigint,
      cache_read_tokens bigint,
      total_tokens bigint,
      cost_usd numeric
    )
    on conflict (user_id, client_id, event_id) do update
    set
      occurred_at = excluded.occurred_at,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      total_tokens = excluded.total_tokens,
      cost_usd = excluded.cost_usd,
      agent = excluded.agent,
      model = excluded.model,
      timezone = excluded.timezone,
      source = excluded.source,
      cli_version = excluded.cli_version,
      generated_at = excluded.generated_at,
      ingested_at = excluded.ingested_at
    where current_usage.generated_at < excluded.generated_at;

    -- v2 is the authoritative, event-level replacement for this client's
    -- approximate daily history; keeping both would double-count.
    delete from public.agent_usage_daily as daily
    where daily.user_id = p_user_id
      and daily.client_id = p_client_id;
  end if;

  update public.agent_api_keys as keys
  set last_used_at = greatest(coalesce(keys.last_used_at, v_now), v_now)
  where keys.id = p_key_id
    and keys.user_id = p_user_id;

  return query select v_inserted, v_replaced, v_stale;
end;
$$;

revoke all on function public.ingest_agent_usage(
  integer, bigint, uuid, text, text, text, text, timestamptz, smallint, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_agent_usage(
  integer, bigint, uuid, text, text, text, text, timestamptz, smallint, jsonb
) to service_role;

-- ----------------------------------------------------------------
-- Exact aggregate: numeric totals, viewer timezone, weighted mixes
-- ----------------------------------------------------------------

drop function if exists public.agent_token_leaderboard(date, date);
drop function if exists public.agent_token_leaderboard(date, date, text);
drop function if exists public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
);

create function public.agent_token_leaderboard(
  p_since date default null,
  p_until date default null,
  p_timezone text default 'UTC',
  p_since_at timestamptz default null,
  p_until_at timestamptz default null
)
returns table (
  user_id integer,
  username text,
  display_name text,
  profile_image text,
  input_tokens numeric,
  output_tokens numeric,
  cache_creation_tokens numeric,
  cache_read_tokens numeric,
  total_tokens numeric,
  cost_usd numeric,
  active_days bigint,
  client_count bigint,
  agents text[],
  models text[],
  last_synced_at timestamptz,
  top_agent text,
  top_agent_days bigint,
  top_model text,
  top_model_days bigint,
  top_agent_tokens numeric,
  top_model_tokens numeric,
  agent_breakdown jsonb,
  model_breakdown jsonb,
  agent_breakdown_complete boolean,
  model_breakdown_complete boolean,
  timezone_complete boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select zones.name as timezone
    from pg_catalog.pg_timezone_names as zones
    where zones.name = p_timezone
  ),
  enabled_users as (
    select sharing.user_id
    from public.agent_usage_sharing as sharing
    where sharing.leaderboard_enabled
      and sharing.consent_version >= 2
  ),
  legacy as (
    select
      usage.user_id,
      usage.client_id,
      usage.date as usage_day,
      usage.input_tokens::numeric as input_tokens,
      usage.output_tokens::numeric as output_tokens,
      usage.cache_creation_tokens::numeric as cache_creation_tokens,
      usage.cache_read_tokens::numeric as cache_read_tokens,
      usage.total_tokens::numeric as total_tokens,
      usage.cost_usd,
      usage.agents,
      usage.models,
      usage.ingested_at
    from public.agent_usage_daily as usage
    inner join enabled_users on enabled_users.user_id = usage.user_id
    cross join settings
    where (p_since is null or usage.date >= p_since)
      and (p_until is null or usage.date <= p_until)
  ),
  events as (
    select
      event.user_id,
      event.client_id,
      (event.occurred_at at time zone settings.timezone)::date as usage_day,
      event.input_tokens::numeric as input_tokens,
      event.output_tokens::numeric as output_tokens,
      event.cache_creation_tokens::numeric as cache_creation_tokens,
      event.cache_read_tokens::numeric as cache_read_tokens,
      event.total_tokens::numeric as total_tokens,
      event.cost_usd,
      lower(btrim(event.agent)) as agent,
      lower(btrim(event.model)) as model,
      event.ingested_at
    from public.agent_usage_events as event
    inner join enabled_users on enabled_users.user_id = event.user_id
    cross join settings
    where (
        (p_since_at is not null and event.occurred_at >= p_since_at)
        or (
          p_since_at is null
          and (
            p_since is null
            or event.occurred_at >= (
              p_since::timestamp without time zone at time zone settings.timezone
            )
          )
        )
      )
      and (
        (p_until_at is not null and event.occurred_at < p_until_at)
        or (
          p_until_at is null
          and (
            p_until is null
            or event.occurred_at < (
              (p_until + 1)::timestamp without time zone at time zone settings.timezone
            )
          )
        )
      )
  ),
  facts as (
    select
      legacy.user_id,
      legacy.client_id,
      legacy.usage_day,
      legacy.input_tokens,
      legacy.output_tokens,
      legacy.cache_creation_tokens,
      legacy.cache_read_tokens,
      legacy.total_tokens,
      legacy.cost_usd,
      legacy.ingested_at,
      true as legacy
    from legacy
    union all
    select
      events.user_id,
      events.client_id,
      events.usage_day,
      events.input_tokens,
      events.output_tokens,
      events.cache_creation_tokens,
      events.cache_read_tokens,
      events.total_tokens,
      events.cost_usd,
      events.ingested_at,
      false as legacy
    from events
  ),
  totals as (
    select
      facts.user_id,
      sum(facts.input_tokens) as input_tokens,
      sum(facts.output_tokens) as output_tokens,
      sum(facts.cache_creation_tokens) as cache_creation_tokens,
      sum(facts.cache_read_tokens) as cache_read_tokens,
      sum(facts.total_tokens) as total_tokens,
      sum(facts.cost_usd) as cost_usd,
      count(distinct facts.usage_day)::bigint as active_days,
      count(distinct facts.client_id)::bigint as client_count,
      max(facts.ingested_at) as last_synced_at,
      bool_and(not facts.legacy) as timezone_complete
    from facts
    group by facts.user_id
  ),
  agent_facts as (
    select
      events.user_id,
      events.agent as name,
      events.usage_day,
      events.total_tokens,
      events.ingested_at
    from events
    union all
    select
      legacy.user_id,
      lower(btrim(legacy.agents[1])) as name,
      legacy.usage_day,
      legacy.total_tokens,
      legacy.ingested_at
    from legacy
    where cardinality(legacy.agents) = 1
      and btrim(legacy.agents[1]) <> ''
  ),
  model_facts as (
    select
      events.user_id,
      events.model as name,
      events.usage_day,
      events.total_tokens,
      events.ingested_at
    from events
    union all
    select
      legacy.user_id,
      lower(btrim(legacy.models[1])) as name,
      legacy.usage_day,
      legacy.total_tokens,
      legacy.ingested_at
    from legacy
    where cardinality(legacy.models) = 1
      and btrim(legacy.models[1]) <> ''
  ),
  agent_weights as (
    select
      agent_facts.user_id,
      agent_facts.name,
      sum(agent_facts.total_tokens) as tokens,
      count(distinct agent_facts.usage_day)::bigint as active_days,
      max(agent_facts.ingested_at) as last_seen_at
    from agent_facts
    group by agent_facts.user_id, agent_facts.name
  ),
  model_weights as (
    select
      model_facts.user_id,
      model_facts.name,
      sum(model_facts.total_tokens) as tokens,
      count(distinct model_facts.usage_day)::bigint as active_days,
      max(model_facts.ingested_at) as last_seen_at
    from model_facts
    group by model_facts.user_id, model_facts.name
  ),
  ranked_agents as (
    select
      agent_weights.*,
      row_number() over (
        partition by agent_weights.user_id
        order by
          agent_weights.tokens desc,
          agent_weights.last_seen_at desc,
          agent_weights.name asc
      ) as rank
    from agent_weights
  ),
  ranked_models as (
    select
      model_weights.*,
      row_number() over (
        partition by model_weights.user_id
        order by
          model_weights.tokens desc,
          model_weights.last_seen_at desc,
          model_weights.name asc
      ) as rank
    from model_weights
  ),
  agent_summaries as (
    select
      agent_weights.user_id,
      array_agg(agent_weights.name order by agent_weights.name) as agents,
      jsonb_agg(
        jsonb_build_object(
          'name', agent_weights.name,
          'totalTokens', agent_weights.tokens::text
        )
        order by agent_weights.tokens desc, agent_weights.name asc
      ) as breakdown,
      sum(agent_weights.tokens) as attributed_tokens
    from agent_weights
    group by agent_weights.user_id
  ),
  model_summaries as (
    select
      model_weights.user_id,
      array_agg(model_weights.name order by model_weights.name) as models,
      jsonb_agg(
        jsonb_build_object(
          'name', model_weights.name,
          'totalTokens', model_weights.tokens::text
        )
        order by model_weights.tokens desc, model_weights.name asc
      ) as breakdown,
      sum(model_weights.tokens) as attributed_tokens
    from model_weights
    group by model_weights.user_id
  ),
  legacy_agent_mix as (
    select distinct
      legacy.user_id,
      lower(btrim(agent_name)) as name
    from legacy
    cross join lateral unnest(legacy.agents) as agent_name
    where btrim(agent_name) <> ''
  ),
  legacy_model_mix as (
    select distinct
      legacy.user_id,
      lower(btrim(model_name)) as name
    from legacy
    cross join lateral unnest(legacy.models) as model_name
    where btrim(model_name) <> ''
  ),
  all_agents as (
    select agent_weights.user_id, agent_weights.name from agent_weights
    union
    select legacy_agent_mix.user_id, legacy_agent_mix.name from legacy_agent_mix
  ),
  all_models as (
    select model_weights.user_id, model_weights.name from model_weights
    union
    select legacy_model_mix.user_id, legacy_model_mix.name from legacy_model_mix
  ),
  agent_mix as (
    select all_agents.user_id, array_agg(all_agents.name order by all_agents.name) as agents
    from all_agents
    group by all_agents.user_id
  ),
  model_mix as (
    select all_models.user_id, array_agg(all_models.name order by all_models.name) as models
    from all_models
    group by all_models.user_id
  )
  select
    users.id as user_id,
    coalesce(nullif(users.twitter_username, ''), 'User' || users.id::text) as username,
    coalesce(
      nullif(users.twitter_name, ''),
      nullif(users.twitter_username, ''),
      'User' || users.id::text
    ) as display_name,
    users.twitter_profile_image as profile_image,
    totals.input_tokens,
    totals.output_tokens,
    totals.cache_creation_tokens,
    totals.cache_read_tokens,
    totals.total_tokens,
    totals.cost_usd,
    totals.active_days,
    totals.client_count,
    coalesce(agent_mix.agents, '{}'::text[]) as agents,
    coalesce(model_mix.models, '{}'::text[]) as models,
    totals.last_synced_at,
    top_agent.name as top_agent,
    coalesce(top_agent.active_days, 0)::bigint as top_agent_days,
    top_model.name as top_model,
    coalesce(top_model.active_days, 0)::bigint as top_model_days,
    coalesce(top_agent.tokens, 0)::numeric as top_agent_tokens,
    coalesce(top_model.tokens, 0)::numeric as top_model_tokens,
    coalesce(agent_summaries.breakdown, '[]'::jsonb) as agent_breakdown,
    coalesce(model_summaries.breakdown, '[]'::jsonb) as model_breakdown,
    coalesce(agent_summaries.attributed_tokens, 0) = totals.total_tokens
      as agent_breakdown_complete,
    coalesce(model_summaries.attributed_tokens, 0) = totals.total_tokens
      as model_breakdown_complete,
    totals.timezone_complete
  from totals
  inner join public.users as users
    on users.id = totals.user_id
   and users.status = 'active'
  left join agent_mix on agent_mix.user_id = totals.user_id
  left join model_mix on model_mix.user_id = totals.user_id
  left join ranked_agents as top_agent
    on top_agent.user_id = totals.user_id
   and top_agent.rank = 1
  left join ranked_models as top_model
    on top_model.user_id = totals.user_id
   and top_model.rank = 1
  left join agent_summaries on agent_summaries.user_id = totals.user_id
  left join model_summaries on model_summaries.user_id = totals.user_id
  order by totals.cost_usd desc, totals.total_tokens desc, users.id asc;
$$;

comment on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
) is
  'Service-only exact-numeric Burn Board aggregate. V2 events are bucketed in the viewer IANA timezone and agent/model leaders are token-weighted; completeness flags identify legacy daily data.';

revoke all on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  from public, anon, authenticated;
grant execute on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  to service_role;
