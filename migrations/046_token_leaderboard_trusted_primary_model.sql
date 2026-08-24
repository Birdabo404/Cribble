-- Agent v1.2+ orders each daily models array by ccusage token volume. Use
-- that privacy-preserving ordering to identify the daily primary model,
-- then choose the model that led on the most days in the requested window.
-- Older Agent rows are deliberately not guessed from alphabetical arrays.

create or replace function public.agent_token_leaderboard(
  p_since date default null,
  p_until date default null
)
returns table (
  user_id integer,
  username text,
  display_name text,
  profile_image text,
  input_tokens bigint,
  output_tokens bigint,
  cache_creation_tokens bigint,
  cache_read_tokens bigint,
  total_tokens bigint,
  cost_usd numeric,
  active_days bigint,
  client_count bigint,
  agents text[],
  models text[],
  last_synced_at timestamptz,
  top_agent text,
  top_agent_days bigint,
  top_model text,
  top_model_days bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select
      usage.*,
      case
        when usage.cli_version ~ '^[0-9]+\.[0-9]+\.' then
          case
            when split_part(usage.cli_version, '.', 1)::integer > 1
              or (
                split_part(usage.cli_version, '.', 1)::integer = 1
                and split_part(usage.cli_version, '.', 2)::integer >= 2
              )
            then nullif(lower(btrim(coalesce(usage.models[1], ''))), '')
          end
      end as primary_model
    from public.agent_usage_daily as usage
    inner join public.agent_usage_sharing as sharing
      on sharing.user_id = usage.user_id
     and sharing.leaderboard_enabled
    where (p_since is null or usage.date >= p_since)
      and (p_until is null or usage.date <= p_until)
  ),
  totals as (
    select
      filtered.user_id,
      sum(filtered.input_tokens)::bigint as input_tokens,
      sum(filtered.output_tokens)::bigint as output_tokens,
      sum(filtered.cache_creation_tokens)::bigint as cache_creation_tokens,
      sum(filtered.cache_read_tokens)::bigint as cache_read_tokens,
      sum(filtered.total_tokens)::bigint as total_tokens,
      sum(filtered.cost_usd)::numeric as cost_usd,
      count(distinct filtered.date)::bigint as active_days,
      count(distinct filtered.client_id)::bigint as client_count,
      max(filtered.ingested_at) as last_synced_at
    from filtered
    group by filtered.user_id
  ),
  agent_mix as (
    select
      filtered.user_id,
      array_agg(distinct lower(btrim(agent_name)) order by lower(btrim(agent_name))) as agents
    from filtered
    cross join lateral unnest(filtered.agents) as agent_name
    where btrim(agent_name) <> ''
    group by filtered.user_id
  ),
  agent_counts as (
    select
      filtered.user_id,
      lower(btrim(agent_name)) as agent_name,
      count(distinct filtered.date)::bigint as active_days,
      max(filtered.ingested_at) as last_seen_at
    from filtered
    cross join lateral unnest(filtered.agents) as agent_name
    where btrim(agent_name) <> ''
    group by filtered.user_id, lower(btrim(agent_name))
  ),
  ranked_agents as (
    select
      agent_counts.*,
      row_number() over (
        partition by agent_counts.user_id
        order by
          agent_counts.active_days desc,
          agent_counts.last_seen_at desc,
          agent_counts.agent_name asc
      ) as agent_rank
    from agent_counts
  ),
  top_agents as (
    select
      ranked_agents.user_id,
      ranked_agents.agent_name,
      ranked_agents.active_days
    from ranked_agents
    where ranked_agents.agent_rank = 1
  ),
  model_mix as (
    select
      filtered.user_id,
      array_agg(distinct lower(btrim(model_name)) order by lower(btrim(model_name))) as models
    from filtered
    cross join lateral unnest(filtered.models) as model_name
    where btrim(model_name) <> ''
    group by filtered.user_id
  ),
  model_counts as (
    select
      filtered.user_id,
      filtered.primary_model as model_name,
      count(distinct filtered.date)::bigint as primary_days,
      max(filtered.ingested_at) as last_seen_at
    from filtered
    where filtered.primary_model is not null
    group by filtered.user_id, filtered.primary_model
  ),
  ranked_models as (
    select
      model_counts.*,
      row_number() over (
        partition by model_counts.user_id
        order by
          model_counts.primary_days desc,
          model_counts.last_seen_at desc,
          model_counts.model_name asc
      ) as model_rank
    from model_counts
  ),
  top_models as (
    select
      ranked_models.user_id,
      ranked_models.model_name,
      ranked_models.primary_days
    from ranked_models
    where ranked_models.model_rank = 1
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
    top_agents.agent_name as top_agent,
    coalesce(top_agents.active_days, 0)::bigint as top_agent_days,
    top_models.model_name as top_model,
    coalesce(top_models.primary_days, 0)::bigint as top_model_days
  from totals
  inner join public.users as users
    on users.id = totals.user_id
   and users.status = 'active'
  left join agent_mix on agent_mix.user_id = totals.user_id
  left join model_mix on model_mix.user_id = totals.user_id
  left join top_agents on top_agents.user_id = totals.user_id
  left join top_models on top_models.user_id = totals.user_id
  order by totals.cost_usd desc, totals.total_tokens desc, users.id asc;
$$;

comment on function public.agent_token_leaderboard(date, date) is
  'Service-only aggregate for opted-in active users. Agent is ranked by reported active days; model is ranked by daily token-volume leadership from Agent v1.2+ ordering. Values are self-reported and estimated cost is not a billing receipt.';

revoke all on function public.agent_token_leaderboard(date, date)
  from public, anon, authenticated;
grant execute on function public.agent_token_leaderboard(date, date)
  to service_role;
