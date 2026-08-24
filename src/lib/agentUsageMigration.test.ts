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
})
