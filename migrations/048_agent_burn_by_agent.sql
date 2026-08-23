-- ============================================================
-- Migration 048: Per-agent burn aggregate (display-only)
-- ============================================================
-- The AI board wants a USD burn column per tool. Per-agent USD exists
-- ONLY in agent_usage_events (one agent per fact, migration 047) plus
-- the legacy agent_usage_daily rows whose whole day is attributable to
-- a single agent (cardinality(agents) = 1 — the same rule migration
-- 047 uses for agent_facts). Multi-agent legacy days are deliberately
-- dropped: prorating a day's cost by token share would be invented
-- money.
--
-- Consent gate copied from 047 verbatim: only users who opted into
-- token sharing (leaderboard_enabled AND consent_version >= 2) and are
-- still active contribute. Service-role only, like every other
-- leaderboard aggregate.
-- ============================================================

create or replace function public.agent_burn_by_agent(
  p_since_at timestamptz default null
)
returns table (
  agent text,
  cost_usd numeric,
  pilots bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enabled_users as (
    select sharing.user_id
    from public.agent_usage_sharing as sharing
    where sharing.leaderboard_enabled
      and sharing.consent_version >= 2
  ),
  facts as (
    select
      lower(btrim(event.agent)) as agent,
      event.cost_usd,
      event.user_id
    from public.agent_usage_events as event
    inner join enabled_users on enabled_users.user_id = event.user_id
    inner join public.users as users
      on users.id = event.user_id
     and users.status = 'active'
    where p_since_at is null
      or event.occurred_at >= p_since_at
    union all
    select
      lower(btrim(usage.agents[1])) as agent,
      usage.cost_usd,
      usage.user_id
    from public.agent_usage_daily as usage
    inner join enabled_users on enabled_users.user_id = usage.user_id
    inner join public.users as users
      on users.id = usage.user_id
     and users.status = 'active'
    where cardinality(usage.agents) = 1
      and btrim(usage.agents[1]) <> ''
      and (
        p_since_at is null
        or usage.date >= (p_since_at at time zone 'UTC')::date
      )
  )
  select
    facts.agent,
    sum(facts.cost_usd) as cost_usd,
    count(distinct facts.user_id)::bigint as pilots
  from facts
  group by facts.agent;
$$;

comment on function public.agent_burn_by_agent(timestamptz) is
  'Consent-gated site-wide aggregate: estimated USD per agent for opted-in (leaderboard_enabled AND consent_version >= 2) active users. Event facts plus single-agent legacy days only — display-only decoration, never a ranking input.';

revoke all on function public.agent_burn_by_agent(timestamptz)
  from public, anon, authenticated;
grant execute on function public.agent_burn_by_agent(timestamptz)
  to service_role;
