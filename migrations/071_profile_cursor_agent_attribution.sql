-- ============================================================
-- Migration 071: Cursor attribution on public profiles
-- ============================================================
-- agent_profile_agents originally read only cribble-agent facts. A user
-- could separately publish a linked cursor.com profile on THE BURN, but
-- those Cursor tokens never reached the profile AGENTIC block. Mixed-agent
-- legacy days then left most of the displayed share unattributed.
--
-- Linked Cursor attribution requires BOTH existing public-display choices:
--   - agent_usage_sharing consent v2 authorizes public agent/model breakdowns;
--   - cursor_profiles.board_enabled authorizes publishing the linked Cursor
--     token source, and its latest sync must be healthy.
--
-- Linked Cursor is an overlapping source, not extra usage. Keep the larger
-- of linked and exact CLI Cursor attribution. The percentage
-- denominator is the greater of:
--   - the full CLI total (which may already contain Cursor on mixed days);
--   - exact non-Cursor attribution + linked Cursor tokens.
-- This conservative union keeps unattributed CLI usage in the denominator
-- without ever adding the linked Cursor total on top of an overlapping CLI
-- total. If no linked Cursor data is public, the original CLI-only behavior
-- is preserved.
-- Safe to run multiple times.
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
  with target as (
    select users.id as user_id
    from public.users as users
    inner join public.agent_usage_sharing as sharing
      on sharing.user_id = users.id
     and sharing.leaderboard_enabled
     and sharing.consent_version >= 2
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
  cursor_daily as (
    select
      daily.day as usage_day,
      daily.tokens::numeric as total_tokens
    from public.cursor_profiles as profile
    inner join target on target.user_id = profile.user_id
    inner join public.cursor_profile_daily as daily
      on daily.user_id = profile.user_id
    where profile.board_enabled
      and profile.last_sync_status = 'ok'
      and daily.tokens > 0
  ),
  cursor_total as (
    select nullif(sum(cursor_daily.total_tokens), 0)::numeric as tokens
    from cursor_daily
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
  cli_agent_weights as (
    select agent_facts.name, sum(agent_facts.total_tokens) as tokens
    from agent_facts
    group by agent_facts.name
  ),
  cli_cursor as (
    select sum(cli_agent_weights.tokens)::numeric as tokens
    from cli_agent_weights
    where lower(
      regexp_replace(btrim(cli_agent_weights.name), '[ _]+', '-', 'g')
    ) in ('cursor', 'cursor-agent')
  ),
  non_cursor_weights as (
    select cli_agent_weights.name, cli_agent_weights.tokens
    from cli_agent_weights
    where lower(
      regexp_replace(btrim(cli_agent_weights.name), '[ _]+', '-', 'g')
    ) not in ('cursor', 'cursor-agent')
  ),
  non_cursor_total as (
    select sum(non_cursor_weights.tokens)::numeric as tokens
    from non_cursor_weights
  ),
  merged_cursor as (
    select greatest(
      coalesce(cursor_total.tokens, 0),
      coalesce(cli_cursor.tokens, 0)
    )::numeric as tokens
    from cursor_total
    cross join cli_cursor
  ),
  agent_weights as (
    select non_cursor_weights.name, non_cursor_weights.tokens
    from non_cursor_weights
    union all
    select 'cursor'::text as name, merged_cursor.tokens
    from merged_cursor
    where merged_cursor.tokens > 0
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
      sum(agent_weights.tokens)::numeric as attributed_tokens
    from agent_weights
  ),
  cli_totals as (
    select
      sum(facts.total_tokens)::numeric as total_tokens,
      sum(facts.cost_usd)::numeric as cost_usd
    from facts
  ),
  merged_totals as (
    select
      greatest(
        coalesce(cli_totals.total_tokens, 0),
        coalesce(non_cursor_total.tokens, 0) + merged_cursor.tokens
      )::numeric as total_tokens,
      coalesce(cli_totals.cost_usd, 0)::numeric as cost_usd
    from cli_totals
    cross join non_cursor_total
    cross join merged_cursor
  ),
  usage_days as (
    select facts.usage_day
    from facts
    union
    select cursor_daily.usage_day
    from cursor_daily
  ),
  day_totals as (
    select count(*)::bigint as active_days
    from usage_days
  )
  select
    merged_totals.total_tokens,
    merged_totals.cost_usd,
    day_totals.active_days,
    coalesce(agent_summaries.breakdown, '[]'::jsonb) as agent_breakdown,
    coalesce(agent_summaries.attributed_tokens, 0) = merged_totals.total_tokens
      as agent_breakdown_complete
  from merged_totals
  cross join day_totals
  cross join agent_summaries
  where merged_totals.total_tokens > 0;
$$;

comment on function public.agent_profile_agents(integer) is
  'Consent-gated public-profile agent mix. Linked Cursor requires agent-breakdown consent plus the Cursor board opt-in, and merges with exact CLI Cursor via a conservative source maximum so overlap is never double-counted or discarded.';

revoke all on function public.agent_profile_agents(integer)
  from public, anon, authenticated;
grant execute on function public.agent_profile_agents(integer)
  to service_role;

notify pgrst, 'reload schema';
