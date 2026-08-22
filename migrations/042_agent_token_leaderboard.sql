-- Opt-in public token leaderboard. Raw agent usage remains service-role only;
-- this table stores only the owner's sharing choice, and the RPC returns a
-- bounded aggregate for accounts that deliberately joined the board.

create table public.agent_usage_sharing (
  user_id integer primary key
    references public.users(id) on delete cascade,
  leaderboard_enabled boolean not null default false,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_usage_sharing_enabled_at_check check (
    (leaderboard_enabled and enabled_at is not null)
    or (not leaderboard_enabled and enabled_at is null)
  )
);

comment on table public.agent_usage_sharing is
  'Explicit opt-in for the public, self-reported token Burn Board. Service-role only; disabling removes the user from public aggregates immediately.';
comment on column public.agent_usage_sharing.leaderboard_enabled is
  'True only after the user explicitly agrees to publish identity, aggregate token totals, and estimated cost.';

alter table public.agent_usage_sharing enable row level security;
revoke all on table public.agent_usage_sharing from public, anon, authenticated;
grant select, insert, update, delete on table public.agent_usage_sharing to service_role;

-- The public board always begins with enabled owners, so keep that working
-- set small without indexing disabled rows.
create index idx_agent_usage_sharing_enabled_user
  on public.agent_usage_sharing(user_id)
  where leaderboard_enabled;

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
  last_synced_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select usage.*
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
      array_agg(distinct agent_name order by agent_name) as agents
    from filtered
    cross join lateral unnest(filtered.agents) as agent_name
    group by filtered.user_id
  ),
  model_mix as (
    select
      filtered.user_id,
      array_agg(distinct model_name order by model_name) as models
    from filtered
    cross join lateral unnest(filtered.models) as model_name
    group by filtered.user_id
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
    totals.last_synced_at
  from totals
  inner join public.users as users
    on users.id = totals.user_id
   and users.status = 'active'
  left join agent_mix on agent_mix.user_id = totals.user_id
  left join model_mix on model_mix.user_id = totals.user_id
  order by totals.cost_usd desc, totals.total_tokens desc, users.id asc;
$$;

comment on function public.agent_token_leaderboard(date, date) is
  'Service-only aggregate for opted-in active users. Values are self-reported by Cribble Agent and estimated cost is not a billing receipt.';

revoke all on function public.agent_token_leaderboard(date, date)
  from public, anon, authenticated;
grant execute on function public.agent_token_leaderboard(date, date)
  to service_role;
