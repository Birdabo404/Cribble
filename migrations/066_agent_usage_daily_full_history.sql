-- ============================================================
-- Migration 066: Accept complete schema-v1 daily history and exact breakdowns
-- ============================================================

alter table public.agent_usage_daily
  add column if not exists agent_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists model_breakdown jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'agent_usage_daily_breakdowns_are_arrays'
      and conrelid = 'public.agent_usage_daily'::regclass
  ) then
    alter table public.agent_usage_daily
      add constraint agent_usage_daily_breakdowns_are_arrays
      check (
        jsonb_typeof(agent_breakdown) = 'array'
        and jsonb_typeof(model_breakdown) = 'array'
      );
  end if;
end
$$;

comment on column public.agent_usage_daily.agent_breakdown is
  'Exact per-agent token components reported by ccusage for this daily fact. Empty means attribution was unavailable.';
comment on column public.agent_usage_daily.model_breakdown is
  'Exact per-model token components reported by ccusage for this daily fact. Empty means attribution was unavailable.';
-- Daily snapshots remain bounded to 365 unique records, but those
-- records may now retain their original historical dates. Future
-- dates, fresh generatedAt, event age, and all numeric bounds remain.
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
        models text[],
        agent_breakdown jsonb,
        model_breakdown jsonb
      )
      where record.date > v_generated_date
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
        or jsonb_typeof(record.agent_breakdown) <> 'array'
        or jsonb_typeof(record.model_breakdown) <> 'array'
        or exists (
          select 1
          from jsonb_to_recordset(record.agent_breakdown) as breakdown (
            name text,
            input_tokens bigint,
            output_tokens bigint,
            cache_creation_tokens bigint,
            cache_read_tokens bigint
          )
          where btrim(coalesce(breakdown.name, '')) = ''
            or char_length(breakdown.name) > 128
            or breakdown.input_tokens not between 0 and 1000000000000
            or breakdown.output_tokens not between 0 and 1000000000000
            or breakdown.cache_creation_tokens not between 0 and 1000000000000
            or breakdown.cache_read_tokens not between 0 and 1000000000000
        )
        or exists (
          select 1
          from jsonb_to_recordset(record.model_breakdown) as breakdown (
            name text,
            input_tokens bigint,
            output_tokens bigint,
            cache_creation_tokens bigint,
            cache_read_tokens bigint
          )
          where btrim(coalesce(breakdown.name, '')) = ''
            or char_length(breakdown.name) > 128
            or breakdown.input_tokens not between 0 and 1000000000000
            or breakdown.output_tokens not between 0 and 1000000000000
            or breakdown.cache_creation_tokens not between 0 and 1000000000000
            or breakdown.cache_read_tokens not between 0 and 1000000000000
        )
        or exists (
          select 1
          from (
            select
              coalesce(sum(breakdown.input_tokens), 0) as input_tokens,
              coalesce(sum(breakdown.output_tokens), 0) as output_tokens,
              coalesce(sum(breakdown.cache_creation_tokens), 0) as cache_creation_tokens,
              coalesce(sum(breakdown.cache_read_tokens), 0) as cache_read_tokens
            from jsonb_to_recordset(record.agent_breakdown) as breakdown (
              input_tokens bigint,
              output_tokens bigint,
              cache_creation_tokens bigint,
              cache_read_tokens bigint
            )
          ) as totals
          where totals.input_tokens > record.input_tokens
            or totals.output_tokens > record.output_tokens
            or totals.cache_creation_tokens > record.cache_creation_tokens
            or totals.cache_read_tokens > record.cache_read_tokens
        )
        or exists (
          select 1
          from (
            select
              coalesce(sum(breakdown.input_tokens), 0) as input_tokens,
              coalesce(sum(breakdown.output_tokens), 0) as output_tokens,
              coalesce(sum(breakdown.cache_creation_tokens), 0) as cache_creation_tokens,
              coalesce(sum(breakdown.cache_read_tokens), 0) as cache_read_tokens
            from jsonb_to_recordset(record.model_breakdown) as breakdown (
              input_tokens bigint,
              output_tokens bigint,
              cache_creation_tokens bigint,
              cache_read_tokens bigint
            )
          ) as totals
          where totals.input_tokens > record.input_tokens
            or totals.output_tokens > record.output_tokens
            or totals.cache_creation_tokens > record.cache_creation_tokens
            or totals.cache_read_tokens > record.cache_read_tokens
        )
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
      agent_breakdown,
      model_breakdown,
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
      record.agent_breakdown,
      record.model_breakdown,
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
      models text[],
      agent_breakdown jsonb,
      model_breakdown jsonb
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
      agent_breakdown = excluded.agent_breakdown,
      model_breakdown = excluded.model_breakdown,
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
      sum(event.cache_creation_tokens)::bigint,
      sum(event.cache_read_tokens)::bigint,
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
