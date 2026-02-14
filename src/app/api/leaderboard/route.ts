import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Batch query 1: Get all users with their scores and devices in one query
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        twitter_username,
        twitter_name,
        twitter_profile_image,
        created_at,
        last_extension_sync,
        subscription_tier,
        user_scores(total_score),
        user_devices(is_active, last_sync_at)
      `)
      .order('id', { ascending: true })
      .limit(100)

    if (usersError) {
      console.error('[Leaderboard] Users query error:', usersError)
      return NextResponse.json({ success: false, error: usersError.message }, { status: 500 })
    }

    if (!users || users.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    // Batch query 2: Get ALL events for all users at once (instead of 1 query per user)
    const userIds = users.map(u => u.id)
    const { data: allEvents, error: eventsError } = await supabase
      .from('events_raw')
      .select('user_id, domain, visits, active_ms')
      .in('user_id', userIds)

    if (eventsError) {
      console.error('[Leaderboard] Events query error:', eventsError)
    }

    // Group events by user_id in memory
    const eventsByUser: Record<number, typeof allEvents> = {}
    for (const event of allEvents || []) {
      if (!event.user_id) continue
      if (!eventsByUser[event.user_id]) eventsByUser[event.user_id] = []
      eventsByUser[event.user_id]!.push(event)
    }

    // Domain name mapping for AI tools
    const nameMap: Record<string, string> = {
      'chat.openai.com': 'ChatGPT', 'chatgpt.com': 'ChatGPT', 'openai.com': 'OpenAI',
      'claude.ai': 'Claude', 'anthropic.com': 'Claude',
      'gemini.google.com': 'Gemini', 'bard.google.com': 'Bard', 'google.com': 'Google AI',
      'perplexity.ai': 'Perplexity', 'you.com': 'You.com',
      'cursor.sh': 'Cursor', 'copilot.github.com': 'GitHub Copilot', 'github.com': 'GitHub',
      'poe.com': 'Poe', 'huggingface.co': 'Hugging Face',
      'deepseek.com': 'DeepSeek', 'www.deepseek.com': 'DeepSeek', 'chat.deepseek.com': 'DeepSeek'
    }

    const normalizeTier = (t: string | null): 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE' => {
      const v = (t || 'FREE').toUpperCase()
      if (v.includes('AFFILIATE')) return 'AFFILIATE'
      if (v.includes('PREMIUM')) return 'PREMIUM'
      if (v.includes('PRO')) return 'PRO'
      if (v.includes('BASIC')) return 'BASIC'
      return 'FREE'
    }

    // Build leaderboard data — no more per-user DB calls
    const leaderboardData = users.map((user: any) => {
      // Score from joined user_scores
      const score = Math.round(user.user_scores?.total_score || 0)

      // Top tools from pre-fetched events
      const userEvents = eventsByUser[user.id] || []
      const counts: Record<string, { v: number; a: number }> = {}
      for (const ev of userEvents) {
        const d = String(ev.domain || '').toLowerCase()
        if (!d) continue
        const key = Object.keys(nameMap).find(k => d.includes(k)) || d
        if (!counts[key]) counts[key] = { v: 0, a: 0 }
        counts[key].v += (ev.visits || (ev.active_ms ? 1 : 0))
        counts[key].a += (ev.active_ms || 0)
      }
      const visitTotal = Object.values(counts).reduce((s, v) => s + v.v, 0)
      const topTools = Object.entries(counts)
        .sort((a, b) => (b[1].v - a[1].v) || (b[1].a - a[1].a))
        .slice(0, 3)
        .map(([k, val]) => ({
          name: nameMap[k] || (k.split('.')[0] || 'Unknown').replace(/\W+/g, '').slice(0, 12),
          visits: val.v,
          active_ms: val.a,
          percent: visitTotal > 0 ? Math.round((val.v / visitTotal) * 100) : 0
        }))

      // Active status
      const lastSync = user.last_extension_sync || user.user_devices?.[0]?.last_sync_at
      const isActive = lastSync
        ? (Date.now() - new Date(lastSync).getTime()) < (24 * 60 * 60 * 1000)
        : false

      return {
        username: user.twitter_username || `User${user.id}`,
        display_name: user.twitter_name || user.twitter_username || `User${user.id}`,
        profile_image: user.twitter_profile_image || null,
        score,
        isActive,
        lastSeen: lastSync || user.created_at,
        tier: normalizeTier(user.subscription_tier),
        userId: user.id,
        topTools
      }
    })
      .sort((a, b) => b.score - a.score)
      .map((user, idx) => ({ ...user, rank: idx + 1 }))

    return new NextResponse(JSON.stringify({ success: true, data: leaderboardData }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (err: any) {
    console.error('[Leaderboard] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}
