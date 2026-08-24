import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'
import {
  buildUserTokenUsage,
  parseTokenUsageRange,
  type AgentKeyStateRow,
  type AgentUsageDailyRow
} from '@/lib/userTokenUsage'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const PAGE_SIZE = 1_000
const MAX_QUERY_PAGES = 100
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store'
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS
  })
}

async function fetchUsageRows(userId: number, from: string, to: string) {
  const rows: AgentUsageDailyRow[] = []

  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const start = page * PAGE_SIZE
    const { data, error } = await supabase
      .from('agent_usage_daily')
      .select(
        'date, client_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens, cost_usd, agents, models, cli_version, ingested_at'
      )
      .eq('user_id', userId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('client_id', { ascending: true })
      .range(start, start + PAGE_SIZE - 1)

    if (error) return { rows: [], error }

    const pageRows = (data ?? []) as unknown as AgentUsageDailyRow[]
    rows.push(...pageRows)
    if (pageRows.length < PAGE_SIZE) return { rows, error: null }
  }

  return {
    rows: [],
    error: { message: 'Token usage window exceeded the safe query limit' }
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return json({ success: false, error: session.error }, session.status)
    }

    const parsedRange = parseTokenUsageRange(request.nextUrl.searchParams)
    if (!parsedRange.ok) {
      return json({ success: false, error: parsedRange.error }, 400)
    }

    const { from, to } = parsedRange.range
    // Every query is scoped with the server-derived session owner. A userId
    // query parameter, if supplied, is deliberately ignored.
    const [keysResult, firstDateResult, lastDateResult, freshestResult, usageResult] =
      await Promise.all([
        // Private dashboard key status: revocation plus expiry. Avoid
        // selecting hashes, labels, last_used_at, or client metadata.
        supabase
          .from('agent_api_keys')
          .select('revoked_at, expires_at')
          .eq('user_id', session.userId),
        supabase
          .from('agent_usage_daily')
          .select('date')
          .eq('user_id', session.userId)
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('agent_usage_daily')
          .select('date')
          .eq('user_id', session.userId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // A successful ingest is represented by agent_usage_daily.ingested_at.
        // API-key last_used_at is bearer resolution, not dashboard freshness.
        supabase
          .from('agent_usage_daily')
          .select('ingested_at')
          .eq('user_id', session.userId)
          .order('ingested_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        fetchUsageRows(session.userId, from, to)
      ])

    const queryError =
      keysResult.error ??
      firstDateResult.error ??
      lastDateResult.error ??
      freshestResult.error ??
      usageResult.error
    if (queryError) {
      console.error('[UserTokenUsage] Read failed:', queryError.message)
      return json({ success: false, error: 'Failed to load token usage' }, 500)
    }

    const firstDate = (firstDateResult.data as { date?: string } | null)?.date
    const lastDate = (lastDateResult.data as { date?: string } | null)?.date
    const availableBounds =
      firstDate && lastDate ? { from: firstDate, to: lastDate } : null
    const freshestSuccessfulIngestAt = (
      freshestResult.data as { ingested_at?: string } | null
    )?.ingested_at ?? null

    const response = buildUserTokenUsage({
      rows: usageResult.rows,
      keys: (keysResult.data ?? []) as unknown as AgentKeyStateRow[],
      range: parsedRange.range,
      availableBounds,
      freshestSuccessfulIngestAt
    })

    return json(response)
  } catch (error) {
    console.error('[UserTokenUsage] GET error:', error)
    return json({ success: false, error: 'Internal server error' }, 500)
  }
}
