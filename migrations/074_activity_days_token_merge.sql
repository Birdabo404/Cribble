-- ============================================================
-- Migration 074: Merge agent token days into activity_days
-- ============================================================
-- The profile ACTIVITY GRID reads user_scores.activity_days, which
-- until now held only extension focus-time days. CLI token usage
-- (agent_usage_daily) is a second signal: a day lights up when either
-- source has activity. This one-time repair folds the last 91 UTC
-- days of token totals into rows that already store an array.
--
-- NULL activity_days is left NULL — the lazy backfill now merges
-- tokens itself. A non-array value is left alone too. Existing day
-- objects keep their activeMs; `tokens` (summed per date across
-- clients) is added when that date has usage. Dates in the window
-- with tokens but no existing day become
-- {date, activeMs: 0, tokens}. Days are ordered ascending.
--
-- Tokens are recomputed from agent_usage_daily on every run, not
-- added to a previous total, so the statement is safe to repeat.
-- Window start is (current_date - 90); Supabase runs in UTC, so
-- current_date is the UTC day. Future-dated usage is excluded.
-- ============================================================

with token_days as (
  select
    user_id,
    to_char(date, 'YYYY-MM-DD') as date,
    sum(total_tokens)::bigint as tokens
  from public.agent_usage_daily
  where total_tokens > 0
    and date >= (current_date - 90)
    and date <= current_date
  group by user_id, date
),
eligible as (
  select user_id, activity_days
  from public.user_scores
  where jsonb_typeof(activity_days) = 'array'
    and exists (
      select 1
      from token_days
      where token_days.user_id = user_scores.user_id
    )
),
existing as (
  select
    eligible.user_id,
    elem->>'date' as date,
    greatest(
      0,
      round(
        case
          when jsonb_typeof(elem->'activeMs') = 'number'
            then (elem->>'activeMs')::numeric
          when coalesce(elem->>'activeMs', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (elem->>'activeMs')::numeric
          else 0
        end
      )
    )::bigint as active_ms
  from eligible
  cross join lateral jsonb_array_elements(eligible.activity_days) as elem
  where jsonb_typeof(elem) = 'object'
    and coalesce(elem->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
),
existing_one as (
  select user_id, date, max(active_ms) as active_ms
  from existing
  group by user_id, date
),
dates as (
  select user_id, date from existing_one
  union
  select user_id, date from token_days
),
combined as (
  select
    dates.user_id,
    dates.date,
    coalesce(existing_one.active_ms, 0) as active_ms,
    token_days.tokens
  from dates
  join eligible on eligible.user_id = dates.user_id
  left join existing_one
    on existing_one.user_id = dates.user_id
   and existing_one.date = dates.date
  left join token_days
    on token_days.user_id = dates.user_id
   and token_days.date = dates.date
  where coalesce(existing_one.active_ms, 0) > 0
     or coalesce(token_days.tokens, 0) > 0
),
merged as (
  select
    user_id,
    coalesce(
      jsonb_agg(
        jsonb_build_object('date', date, 'activeMs', active_ms)
          || case
               when tokens is not null and tokens > 0
               then jsonb_build_object('tokens', tokens)
               else '{}'::jsonb
             end
        order by date
      ),
      '[]'::jsonb
    ) as activity_days
  from combined
  group by user_id
)
update public.user_scores as scores
set activity_days = merged.activity_days
from merged
where scores.user_id = merged.user_id;

comment on column public.user_scores.activity_days is
  'Rollup: [{date, activeMs, tokens?}] for the last 91 UTC days with extension focus time and/or agent token usage, ascending; NULL means backfill from events_raw (tokens merged on backfill)';
