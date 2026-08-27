import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration046 = readFileSync(
  join(process.cwd(), 'migrations/046_token_leaderboard_trusted_primary_model.sql'),
  'utf8'
)
const migration047 = readFileSync(
  join(process.cwd(), 'migrations/047_agent_usage_integrity.sql'),
  'utf8'
)
const migration049 = readFileSync(
  join(process.cwd(), 'migrations/049_token_leaderboard_ordered_primary_model.sql'),
  'utf8'
)
const migration050 = readFileSync(
  join(process.cwd(), 'migrations/050_agent_usage_v2_preserve_daily.sql'),
  'utf8'
)
const migration057 = readFileSync(
  join(process.cwd(), 'migrations/057_token_leaderboard_legacy_top_agent.sql'),
  'utf8'
)
const migration060 = readFileSync(
  join(process.cwd(), 'migrations/060_agent_usage_local_runtime_ingest.sql'),
  'utf8'
)

describe('Agent usage migrations', () => {
  it('keeps the production-recorded migration 046 in source control input', () => {
    expect(migration046).toContain('create or replace function public.agent_token_leaderboard')
    expect(migration046).toContain('token-volume leadership')
  })

  it('moves staleness and caps into one atomic database transaction', () => {
    expect(migration047).toContain('create or replace function public.ingest_agent_usage')
    expect(migration047).toContain('for update;')
    expect(migration047).toContain('where current_usage.generated_at < excluded.generated_at')
    expect(migration047).toContain("raise exception 'agent_client_limit'")
    expect(migration047).toContain("raise exception 'agent_key_limit'")
  })

  it('adds exact event attribution, named clients, expiry, and bounded numerics', () => {
    expect(migration047).toContain('create table if not exists public.agent_usage_events')
    expect(migration047).toContain('create table if not exists public.agent_usage_clients')
    expect(migration047).toContain('expires_at timestamptz')
    expect(migration047).toContain('numeric(30, 6)')
    expect(migration047).toContain('top_agent_tokens numeric')
    expect(migration047).toContain('top_model_tokens numeric')
    expect(migration047).not.toMatch(/sum\([^\n]+\)::bigint/)
  })

  it('keeps every new raw table and mutation RPC service-role only', () => {
    expect(migration047).toContain('alter table public.agent_usage_clients enable row level security')
    expect(migration047).toContain('alter table public.agent_usage_events enable row level security')
    expect(migration047).toContain(
      'revoke all on table public.agent_usage_events from public, anon, authenticated'
    )
    expect(migration047).toContain('grant execute on function public.ingest_agent_usage')
  })

  it('restores trusted v1.2+ ordered primary models without inventing exact shares', () => {
    expect(migration049).toContain('ordered_primary_model')
    expect(migration049).toContain('model_rank_facts')
    expect(migration049).toContain('cardinality(legacy.models) = 1')
    expect(migration049).toContain('coalesce(top_model_exact.tokens, 0)::numeric')
    expect(migration049).toContain('from public, anon, authenticated')
    expect(migration049).toContain('to service_role')
  })

  it('projects v2 events onto daily rows without wiping uncovered history', () => {
    expect(migration050).toContain('insert into public.agent_usage_daily')
    expect(migration050).toContain(
      'group by (event.occurred_at at time zone event.timezone)::date'
    )
    expect(migration050).toContain('and coalesce(clients.schema_version, 1) < 2')
    expect(migration050).not.toMatch(
      /delete from public\.agent_usage_daily as daily\s+where daily\.user_id = p_user_id\s+and daily\.client_id = p_client_id;/
    )
  })

  it('replaces ingest for local-runtime source and preserves every event fact', () => {
    expect(migration060).toContain("p_source not in ('ccusage', 'cribble-agent')")
    for (const fact of ['request_id', 'event_id', 'occurred_at', 'provider', 'runtime', 'model', 'reasoning_tokens', 'provenance']) {
      expect(migration060).toContain(fact)
    }
    expect(migration060).toContain('create or replace function public.ingest_agent_usage')
  })

  it('restores a legacy top-agent label without inventing token attribution', () => {
    // The fallback CTE unnests every legacy agent name, including
    // multi-agent days, with no single-agent cardinality filter.
    expect(migration057).toMatch(
      /agent_rank_facts as \(\s+select[\s\S]*?cross join lateral unnest\(legacy\.agents\) as agent_name[\s\S]*?\),/
    )
    expect(migration057).not.toMatch(
      /agent_rank_facts as \(\s+select[\s\S]*?cardinality\(legacy\.agents\) = 1[\s\S]*?\),/
    )
    // Fallback ranking mirrors the historical 044 ordering: distinct
    // active days, then most recent sync, then stable name.
    expect(migration057).toContain(
      'count(distinct agent_rank_facts.usage_day)::bigint as active_days'
    )
    expect(migration057).toMatch(
      /agent_rank_weights\.active_days desc,\s+agent_rank_weights\.last_seen_at desc,\s+agent_rank_weights\.name asc/
    )
    // The exact token-weighted rank always wins; the fallback only fills
    // rows where no exact rank-1 agent exists.
    expect(migration057).toContain(
      'coalesce(top_agent.name, fallback_agent.name) as top_agent'
    )
    expect(migration057).toContain(
      'coalesce(top_agent.active_days, fallback_agent.active_days, 0)::bigint'
    )
    // Conservative attribution: fallback rows report zero tokens and the
    // fallback never feeds the exact breakdown.
    expect(migration057).toContain(
      'coalesce(top_agent.tokens, 0)::numeric as top_agent_tokens'
    )
    expect(migration057).not.toContain('fallback_agent.tokens')
    expect(migration057).toContain(
      'coalesce(agent_summaries.breakdown, \'[]\'::jsonb) as agent_breakdown'
    )
    // The RPC stays service-role only.
    expect(migration057).toContain('from public, anon, authenticated')
    expect(migration057).toContain('to service_role')
  })
})
