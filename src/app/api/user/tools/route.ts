import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUserId } from '@/lib/sessionAuth'
import { applyEventsUserEq } from '@/lib/eventsIdentity'
import { eventScore, normalizeLegacyEventValues } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOOL_NAME_MAP: Record<string, string> = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'OpenAI',
  'labs.openai.com': 'DALL·E',
  'playground.openai.com': 'OpenAI Playground',
  'beta.openai.com': 'OpenAI Beta',
  'claude.ai': 'Claude',
  'anthropic.com': 'Claude',
  'gemini.google.com': 'Gemini',
  'aistudio.google.com': 'AI Studio',
  'bard.google.com': 'Bard',
  'grok.x.ai': 'Grok',
  'x.com': 'Grok',
  'chat.deepseek.com': 'DeepSeek',
  'www.deepseek.com': 'DeepSeek',
  'deepseek.com': 'DeepSeek',
  'copilot.github.com': 'Copilot',
  'github.com': 'GitHub Copilot',
  'cursor.sh': 'Cursor',
  'cursor.com': 'Cursor',
  'perplexity.ai': 'Perplexity',
  'you.com': 'You.com',
  'poe.com': 'Poe',
  'huggingface.co': 'Hugging Face',
  'mistral.ai': 'Mistral',
  'groq.com': 'Groq',
  'cohere.ai': 'Cohere',
  'phind.com': 'Phind',
  'together.ai': 'Together AI',
  'replicate.com': 'Replicate',
  'character.ai': 'Character AI',
  'beta.character.ai': 'Character AI',
  'lovable.ai': 'Lovable',
  'lovable.dev': 'Lovable',
  'v0.dev': 'v0',
  'bolt.new': 'Bolt'
}

function resolveToolName(rawDomain: string): string {
  const d = (rawDomain || '').toLowerCase()
  if (!d) return 'Unknown'
  if (TOOL_NAME_MAP[d]) return TOOL_NAME_MAP[d]
  const matchKey = Object.keys(TOOL_NAME_MAP).find((k) => d.includes(k))
  if (matchKey) return TOOL_NAME_MAP[matchKey]
  const fallback = (d.split('.')[0] || 'Unknown')
    .replace(/\W+/g, '')
    .slice(0, 16)
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1), 20)

    let eventsQuery = supabase
      .from('events_raw')
      .select('domain, visits, active_ms, total_ms')
    const { query: scopedEventsQuery, column: eventsUserColumn } =
      await applyEventsUserEq(supabase, eventsQuery, session.userId)
    eventsQuery = scopedEventsQuery

    const { data: events, error } = await eventsQuery

    if (error) {
      console.error('[Tools API] Query error:', error)
      return NextResponse.json(
        { success: false, error: 'Database query failed' },
        { status: 500 }
      )
    }

    if (!eventsUserColumn) {
      console.warn('[Tools API] No compatible events_raw user column found')
    }

    type Agg = { name: string; visits: number; active_ms: number; score: number }
    const grouped: Record<string, Agg> = {}

    for (const ev of events || []) {
      const name = resolveToolName(String(ev.domain || ''))
      if (!grouped[name]) {
        grouped[name] = { name, visits: 0, active_ms: 0, score: 0 }
      }
      const normalized = normalizeLegacyEventValues(ev)
      const visits = normalized.visits
      const activeMs = normalized.activeMs
      grouped[name].visits += visits
      grouped[name].active_ms += activeMs
      grouped[name].score += eventScore(ev)
    }

    const all = Object.values(grouped).sort((a, b) => b.score - a.score || b.visits - a.visits)
    const totalScore = all.reduce((s, t) => s + t.score, 0)
    const totalVisits = all.reduce((s, t) => s + t.visits, 0)

    const tools = all.slice(0, limit).map((t) => ({
      name: t.name,
      visits: t.visits,
      active_ms: t.active_ms,
      score: Math.round(t.score),
      percent: totalScore > 0 ? Math.round((t.score / totalScore) * 100) : 0,
      visitsPercent: totalVisits > 0 ? Math.round((t.visits / totalVisits) * 100) : 0
    }))

    return NextResponse.json({
      success: true,
      tools,
      totals: {
        score: Math.round(totalScore),
        visits: totalVisits,
        distinctTools: all.length
      }
    })
  } catch (err) {
    console.error('[Tools API] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
