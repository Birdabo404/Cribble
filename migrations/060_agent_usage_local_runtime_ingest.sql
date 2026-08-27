-- Local-runtime event facts preserve unknown token classes as NULL.
alter table public.agent_usage_events
  alter column cache_creation_tokens drop not null,
  alter column cache_read_tokens drop not null,
  add column if not exists request_id text,
  add column if not exists provider text,
  add column if not exists runtime text,
  add column if not exists reasoning_tokens bigint,
  add column if not exists provenance text[] not null default '{}';

-- ============================================================
-- Migration 060: Preserve local-runtime event truth during ingest
-- ============================================================
-- 047 already landed in production. Its v2 path deleted every daily row
-- for a client after event upsert, which would blank the private token
-- dashboard and drop uncovered history (event batches are capped at 2000).
--
-- Replace ingest so v2 projects event-covered dates onto agent_usage_daily
-- and leaves uncovered v1 days in place. Replace the Burn Board aggregate
-- so schema-v2 clients contribute events only, preventing double-count.
-- ============================================================

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
  if p_source not in ('ccusage', 'cribble-agent')
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
        request_id text,
        occurred_at timestamptz,
        agent text,
        provider text,
        runtime text,
        model text,
        provenance text[],
        input_tokens bigint,
        output_tokens bigint,
        cache_creation_tokens bigint,
        cache_read_tokens bigint,
        reasoning_tokens bigint,
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
        or (record.cache_creation_tokens is not null and record.cache_creation_tokens not between 0 and 1000000000000)
        or (record.cache_read_tokens is not null and record.cache_read_tokens not between 0 and 1000000000000)
        or (record.reasoning_tokens is not null and record.reasoning_tokens not between 0 and 1000000000000)
        or record.total_tokens not between 0 and 1000000000000
        or record.total_tokens <> record.input_tokens + record.output_tokens
          + coalesce(record.cache_creation_tokens, 0) + coalesce(record.cache_read_tokens, 0)
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
      request_id,
      occurred_at,
      provider,
      runtime,
      provenance,
      reasoning_tokens,
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
      coalesce(record.request_id, record.event_id),
      record.occurred_at,
      nullif(lower(btrim(record.provider)), ''),
      nullif(lower(btrim(record.runtime)), ''),
      coalesce(record.provenance, array[p_source]),
      record.reasoning_tokens,
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
      request_id text,
      occurred_at timestamptz,
      agent text,
      provider text,
      runtime text,
      model text,
      provenance text[],
      input_tokens bigint,
      output_tokens bigint,
      cache_creation_tokens bigint,
      cache_read_tokens bigint,
      reasoning_tokens bigint,
      total_tokens bigint,
      cost_usd numeric
    )
    on conflict (user_id, client_id, event_id) do update
    set
      request_id = excluded.request_id,
      occurred_at = excluded.occurred_at,
      provider = excluded.provider,
      runtime = excluded.runtime,
      provenance = excluded.provenance,
      reasoning_tokens = excluded.reasoning_tokens,
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

    -- Project event facts onto dashboard daily rows for covered dates only.
    -- Uncovered v1 history stays put; the public board ignores v2-client daily
    -- so this projection cannot double-count.
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
      (event.occurred_at at time zone event.timezone)::date,
      sum(event.input_tokens)::bigint,
      sum(event.output_tokens)::bigint,
      sum(coalesce(event.cache_creation_tokens, 0))::bigint,
      sum(coalesce(event.cache_read_tokens, 0))::bigint,
      sum(event.total_tokens)::bigint,
      round(sum(event.cost_usd), 6),
      array_agg(distinct event.agent order by event.agent),
      array_agg(distinct event.model order by event.model),
      p_timezone,
      p_source,
      p_cli_version,
      p_generated_at,
      v_now
    from public.agent_usage_events as event
    where event.user_id = p_user_id
      and event.client_id = p_client_id
    group by (event.occurred_at at time zone event.timezone)::date
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
      ingested_at = excluded.ingested_at;
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

create or replace function public.agent_token_leaderboard(
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
      usage.ingested_at,
      case
        when usage.cli_version ~ '^[vV]?[0-9]+\.[0-9]+(\.|$)' then
          case
            when substring(usage.cli_version from '^[vV]?([0-9]+)')::numeric > 1
              or (
                substring(usage.cli_version from '^[vV]?([0-9]+)')::numeric = 1
                and substring(
                  usage.cli_version from '^[vV]?[0-9]+\.([0-9]+)'
                )::numeric >= 2
              )
            then nullif(lower(btrim(coalesce(usage.models[1], ''))), '')
          end
      end as ordered_primary_model
    from public.agent_usage_daily as usage
    inner join enabled_users on enabled_users.user_id = usage.user_id
    left join public.agent_usage_clients as clients
      on clients.user_id = usage.user_id
     and clients.client_id = usage.client_id
    cross join settings
    where (p_since is null or usage.date >= p_since)
      and (p_until is null or usage.date <= p_until)
      and coalesce(clients.schema_version, 1) < 2
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
  -- Exact model-token facts used for the breakdown and completeness flag.
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
  -- Ranking facts additionally accept the privacy-preserving v1.2+ daily
  -- primary. This restores the label without claiming an exact token share.
  model_rank_facts as (
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
    where btrim(coalesce(legacy.models[1], '')) <> ''
      and (
        cardinality(legacy.models) = 1
        or legacy.ordered_primary_model is not null
      )
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
  model_rank_weights as (
    select
      model_rank_facts.user_id,
      model_rank_facts.name,
      sum(model_rank_facts.total_tokens) as tokens,
      count(distinct model_rank_facts.usage_day)::bigint as active_days,
      max(model_rank_facts.ingested_at) as last_seen_at
    from model_rank_facts
    group by model_rank_facts.user_id, model_rank_facts.name
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
      model_rank_weights.*,
      row_number() over (
        partition by model_rank_weights.user_id
        order by
          model_rank_weights.tokens desc,
          model_rank_weights.last_seen_at desc,
          model_rank_weights.name asc
      ) as rank
    from model_rank_weights
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
    coalesce(top_model_exact.tokens, 0)::numeric as top_model_tokens,
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
  left join model_weights as top_model_exact
    on top_model_exact.user_id = top_model.user_id
   and top_model_exact.name = top_model.name
  left join agent_summaries on agent_summaries.user_id = totals.user_id
  left join model_summaries on model_summaries.user_id = totals.user_id
  order by totals.cost_usd desc, totals.total_tokens desc, users.id asc;
$$;

comment on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
) is
  'Service-only exact-numeric Burn Board aggregate. Event facts remain exact; Agent v1.2+ ordered daily models can restore a primary-model label without claiming an exact multi-model token share.';

revoke all on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  from public, anon, authenticated;
grant execute on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  to service_role;
