-- ============================================================
-- Migration 067: Exact daily agent and model token breakdowns
-- ============================================================
-- Schema-v1 daily snapshots now retain ccusage's exact per-agent and
-- per-model token components. Prefer those facts, keep the established
-- single-label legacy fallback for older rows, and exclude explicitly
-- unattributed reconstructed model names from rankings.
-- ============================================================

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
      usage.agent_breakdown,
      usage.model_breakdown,
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
      lower(btrim(breakdown.name)) as name,
      legacy.usage_day,
      (
        breakdown.input_tokens
        + breakdown.output_tokens
        + breakdown.cache_creation_tokens
        + breakdown.cache_read_tokens
      )::numeric as total_tokens,
      legacy.ingested_at
    from legacy
    cross join lateral jsonb_to_recordset(legacy.agent_breakdown) as breakdown (
      name text,
      input_tokens bigint,
      output_tokens bigint,
      cache_creation_tokens bigint,
      cache_read_tokens bigint
    )
    where btrim(coalesce(breakdown.name, '')) <> ''
      and breakdown.input_tokens + breakdown.output_tokens
        + breakdown.cache_creation_tokens + breakdown.cache_read_tokens > 0
    union all
    select
      legacy.user_id,
      lower(btrim(legacy.agents[1])) as name,
      legacy.usage_day,
      legacy.total_tokens,
      legacy.ingested_at
    from legacy
    where jsonb_array_length(legacy.agent_breakdown) = 0
      and cardinality(legacy.agents) = 1
      and btrim(legacy.agents[1]) <> ''
  ),
  -- Fallback ranking facts accept every legacy-reported agent name, even
  -- from multi-agent days. Like model_rank_facts, this can restore a label
  -- by daily presence without claiming an exact token share.
  agent_rank_facts as (
    select
      legacy.user_id,
      lower(btrim(agent_name)) as name,
      legacy.usage_day,
      legacy.ingested_at
    from legacy
    cross join lateral unnest(legacy.agents) as agent_name
    where btrim(agent_name) <> ''
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
    where events.model not in (
      'unknown', '<unknown>', 'reconstructed-unattributed'
    )
    union all
    select
      legacy.user_id,
      lower(btrim(breakdown.name)) as name,
      legacy.usage_day,
      (
        breakdown.input_tokens
        + breakdown.output_tokens
        + breakdown.cache_creation_tokens
        + breakdown.cache_read_tokens
      )::numeric as total_tokens,
      legacy.ingested_at
    from legacy
    cross join lateral jsonb_to_recordset(legacy.model_breakdown) as breakdown (
      name text,
      input_tokens bigint,
      output_tokens bigint,
      cache_creation_tokens bigint,
      cache_read_tokens bigint
    )
    where lower(btrim(coalesce(breakdown.name, ''))) not in (
        '', 'unknown', '<unknown>', 'reconstructed-unattributed'
      )
      and breakdown.input_tokens + breakdown.output_tokens
        + breakdown.cache_creation_tokens + breakdown.cache_read_tokens > 0
    union all
    select
      legacy.user_id,
      lower(btrim(legacy.models[1])) as name,
      legacy.usage_day,
      legacy.total_tokens,
      legacy.ingested_at
    from legacy
    where jsonb_array_length(legacy.model_breakdown) = 0
      and cardinality(legacy.models) = 1
      and btrim(legacy.models[1]) <> ''
      and lower(btrim(legacy.models[1])) not in (
        'unknown', '<unknown>', 'reconstructed-unattributed'
      )
  ),
  -- Ranking facts additionally accept the privacy-preserving v1.2+ daily
  -- primary. This restores the label without claiming an exact token share.
  model_rank_facts as (
    select
      model_facts.user_id,
      model_facts.name,
      model_facts.usage_day,
      model_facts.total_tokens,
      model_facts.ingested_at
    from model_facts
    union all
    select
      legacy.user_id,
      lower(btrim(legacy.models[1])) as name,
      legacy.usage_day,
      legacy.total_tokens,
      legacy.ingested_at
    from legacy
    where jsonb_array_length(legacy.model_breakdown) = 0
      and cardinality(legacy.models) > 1
      and legacy.ordered_primary_model is not null
      and lower(btrim(coalesce(legacy.models[1], ''))) not in (
        '', 'unknown', '<unknown>', 'reconstructed-unattributed'
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
  agent_rank_weights as (
    select
      agent_rank_facts.user_id,
      agent_rank_facts.name,
      count(distinct agent_rank_facts.usage_day)::bigint as active_days,
      max(agent_rank_facts.ingested_at) as last_seen_at
    from agent_rank_facts
    group by agent_rank_facts.user_id, agent_rank_facts.name
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
  -- Historical 044 ordering: most distinct active days, then most recent
  -- sync, then stable name. Consulted only when no exact rank-1 row exists.
  fallback_ranked_agents as (
    select
      agent_rank_weights.*,
      row_number() over (
        partition by agent_rank_weights.user_id
        order by
          agent_rank_weights.active_days desc,
          agent_rank_weights.last_seen_at desc,
          agent_rank_weights.name asc
      ) as rank
    from agent_rank_weights
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
    where lower(btrim(model_name)) not in (
      '', 'unknown', '<unknown>', 'reconstructed-unattributed'
    )
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
    -- Exact token-weighted winner first; presence-ranked legacy fallback
    -- only when no exact rank exists.
    coalesce(top_agent.name, fallback_agent.name) as top_agent,
    coalesce(top_agent.active_days, fallback_agent.active_days, 0)::bigint
      as top_agent_days,
    top_model.name as top_model,
    coalesce(top_model.active_days, 0)::bigint as top_model_days,
    -- The fallback never contributes tokens: only the exact winner may
    -- claim a share, so ambiguous legacy rows honestly report 0 here.
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
  left join fallback_ranked_agents as fallback_agent
    on fallback_agent.user_id = totals.user_id
   and fallback_agent.rank = 1
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
  'Service-only exact-numeric Burn Board aggregate. Uses exact schema-v1 daily breakdowns and schema-v2 events for token-weighted agent/model rankings; older ambiguous daily rows remain partial and explicitly unattributed.';

revoke all on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  from public, anon, authenticated;
grant execute on function public.agent_token_leaderboard(
  date, date, text, timestamptz, timestamptz
)
  to service_role;
