-- ============================================================
-- Migration 053: Agent usage achievement stats
-- ============================================================
-- One-row lifetime aggregate over agent_usage_daily powering the BURN
-- achievement category. Reads daily — not agent_usage_events — because
-- migration 050 projects v2 event facts onto daily for covered dates,
-- making daily the one grain guaranteed populated for both v1 and v2
-- clients.
--
-- evaluateAchievements runs on every achievements page read and after
-- every extension sync, and daily is one row per client per day (up to
-- 10 clients), so the aggregation lives in SQL instead of pulling rows
-- into TypeScript.
--
-- Always returns exactly one row, with zeros (never NULL) for users
-- with no usage. The agent usage tables are service-role only; the
-- function follows the same posture. Safe to run multiple times.
-- ============================================================

create or replace function public.agent_usage_achievement_stats(
  p_user_id integer
)
returns table (
  total_tokens numeric,
  output_tokens numeric,
  cache_tokens numeric,
  cost_usd numeric,
  model_count bigint,
  agent_count bigint,
  active_days bigint,
  best_day_tokens numeric,
  client_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with daily as (
    select
      usage.client_id,
      usage.date,
      usage.total_tokens::numeric as total_tokens,
      usage.output_tokens::numeric as output_tokens,
      (usage.cache_creation_tokens + usage.cache_read_tokens)::numeric
        as cache_tokens,
      usage.cost_usd,
      usage.agents,
      usage.models
    from public.agent_usage_daily as usage
    where usage.user_id = p_user_id
  ),
  totals as (
    select
      coalesce(sum(daily.total_tokens), 0) as total_tokens,
      coalesce(sum(daily.output_tokens), 0) as output_tokens,
      coalesce(sum(daily.cache_tokens), 0) as cache_tokens,
      coalesce(sum(daily.cost_usd), 0) as cost_usd,
      count(distinct daily.date) filter (where daily.total_tokens > 0)
        as active_days,
      count(distinct daily.client_id) as client_count
    from daily
  ),
  -- Best day sums across clients first, then takes the max.
  day_totals as (
    select sum(daily.total_tokens) as total_tokens
    from daily
    group by daily.date
  ),
  model_names as (
    select distinct lower(btrim(model_name)) as name
    from daily
    cross join lateral unnest(daily.models) as model_name
    where btrim(model_name) <> ''
  ),
  agent_names as (
    select distinct lower(btrim(agent_name)) as name
    from daily
    cross join lateral unnest(daily.agents) as agent_name
    where btrim(agent_name) <> ''
  )
  select
    totals.total_tokens,
    totals.output_tokens,
    totals.cache_tokens,
    totals.cost_usd,
    (select count(*) from model_names)::bigint as model_count,
    (select count(*) from agent_names)::bigint as agent_count,
    totals.active_days::bigint,
    coalesce((select max(day_totals.total_tokens) from day_totals), 0)
      as best_day_tokens,
    totals.client_count::bigint
  from totals;
$$;

comment on function public.agent_usage_achievement_stats(integer) is
  'Service-only one-row lifetime token aggregate over agent_usage_daily for BURN achievement evaluation. Returns zeros for users with no usage.';

revoke all on function public.agent_usage_achievement_stats(integer)
  from public, anon, authenticated;
grant execute on function public.agent_usage_achievement_stats(integer)
  to service_role;
