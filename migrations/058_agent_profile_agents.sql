-- ============================================================
-- Migration 058: Per-user agent breakdown for the public profile
-- ============================================================
-- The profile page grows an AGENTIC block beneath TOP TOOLS: which CLI
-- agents (Cursor, Claude Code, Codex, ...) a pilot runs, ranked by
-- share of lifetime tokens. One row per requested user, aggregated over
-- the same facts the Burn Board uses, so the two surfaces can never
-- disagree about a player's agent mix.
--
-- Facts mirror agent_token_leaderboard (057): exact v2 events, plus
-- legacy agent_usage_daily days from pre-v2 clients. Agent attribution
-- accepts only unambiguous facts — event rows carry one agent each, and
-- legacy days count only when the whole day named a single agent
-- (cardinality(agents) = 1). Multi-agent legacy days still feed the
-- totals, so the completeness flag honestly reports partial breakdowns.
--
-- Consent gate copied from 057 verbatim: only users who opted into
-- token sharing (leaderboard_enabled AND consent_version >= 2) and are
-- still active return a row. Everyone else — including the owner on
-- their own profile — gets zero rows. Service-role only, like every
-- other leaderboard aggregate.
-- ============================================================

create or replace function public.agent_profile_agents(
  p_user_id integer
)
returns table (
  total_tokens numeric,
  cost_usd numeric,
  active_days bigint,
  agent_breakdown jsonb,
  agent_breakdown_complete boolean
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
  target as (
    select users.id as user_id
    from public.users as users
    inner join enabled_users on enabled_users.user_id = users.id
    where users.id = p_user_id
      and users.status = 'active'
  ),
  legacy as (
    select
      usage.date as usage_day,
      usage.total_tokens::numeric as total_tokens,
      usage.cost_usd,
      usage.agents
    from public.agent_usage_daily as usage
    inner join target on target.user_id = usage.user_id
    left join public.agent_usage_clients as clients
      on clients.user_id = usage.user_id
     and clients.client_id = usage.client_id
    where coalesce(clients.schema_version, 1) < 2
  ),
  events as (
    select
      (event.occurred_at at time zone 'UTC')::date as usage_day,
      event.total_tokens::numeric as total_tokens,
      event.cost_usd,
      lower(btrim(event.agent)) as agent
    from public.agent_usage_events as event
    inner join target on target.user_id = event.user_id
  ),
  facts as (
    select legacy.usage_day, legacy.total_tokens, legacy.cost_usd
    from legacy
    union all
    select events.usage_day, events.total_tokens, events.cost_usd
    from events
  ),
  agent_facts as (
    select events.agent as name, events.total_tokens
    from events
    union all
    select lower(btrim(legacy.agents[1])) as name, legacy.total_tokens
    from legacy
    where cardinality(legacy.agents) = 1
      and btrim(legacy.agents[1]) <> ''
  ),
  agent_weights as (
    select agent_facts.name, sum(agent_facts.total_tokens) as tokens
    from agent_facts
    group by agent_facts.name
  ),
  agent_summaries as (
    select
      jsonb_agg(
        jsonb_build_object(
          'name', agent_weights.name,
          'totalTokens', agent_weights.tokens::text
        )
        order by agent_weights.tokens desc, agent_weights.name asc
      ) as breakdown,
      sum(agent_weights.tokens) as attributed_tokens
    from agent_weights
  ),
  totals as (
    select
      sum(facts.total_tokens) as total_tokens,
      sum(facts.cost_usd) as cost_usd,
      count(distinct facts.usage_day)::bigint as active_days
    from facts
  )
  select
    totals.total_tokens,
    totals.cost_usd,
    totals.active_days,
    coalesce(agent_summaries.breakdown, '[]'::jsonb) as agent_breakdown,
    coalesce(agent_summaries.attributed_tokens, 0) = totals.total_tokens
      as agent_breakdown_complete
  from totals
  cross join agent_summaries
  where totals.total_tokens is not null;
$$;

comment on function public.agent_profile_agents(integer) is
  'Consent-gated lifetime agent breakdown for one user''s public profile. Zero rows unless the user opted into token sharing (leaderboard_enabled AND consent_version >= 2), is active, and has usage. Same facts as agent_token_leaderboard: event rows plus single-agent legacy days — display-only decoration, never a ranking input.';

revoke all on function public.agent_profile_agents(integer)
  from public, anon, authenticated;
grant execute on function public.agent_profile_agents(integer)
  to service_role;
