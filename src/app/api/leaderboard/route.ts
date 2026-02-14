import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    console.log('[Leaderboard API] Fetching leaderboard data...')
    // Get users (left join devices if present)
    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        twitter_username,
        twitter_name,
        twitter_profile_image,
        last_login,
        created_at,
        last_extension_sync,
        subscription_tier,
        user_devices(
          is_active,
          last_sync_at
        )
      `)
      .order('id', { ascending: true })
      .limit(100)

    if (error) {
      console.error('[Leaderboard API] Supabase error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    console.log(`[Leaderboard API] Found ${users?.length || 0} users`)

    // Helper: normalize subscription tiers coming from DB (handles PREMIUM+ etc.)
    const normalizeTier = (t: string | null): 'FREE' | 'BASIC' | 'PRO' | 'PREMIUM' | 'AFFILIATE' => {
      const v = (t || 'FREE').toUpperCase()
      if (v.includes('AFFILIATE')) return 'AFFILIATE'
      if (v.includes('PREMIUM')) return 'PREMIUM'
      if (v.includes('PRO')) return 'PRO'
      if (v.includes('BASIC')) return 'BASIC'
      return 'FREE'
    }

    // Get scores from the new centralized scoring system
    const leaderboardPromises = (users || []).map(async (user: any) => {
      // Get user's calculated scores from user_scores table
      const { data: userScores } = await supabase
        .from('user_scores')
        .select('*')
        .eq('user_id', user.id)
        .single()

      // If no scores calculated yet, trigger calculation and use 0 for now
      let totalScore = 0
      if (userScores) {
        totalScore = userScores.total_score
      } else {
        // Trigger score calculation for users without scores
        try {
          await supabase.rpc('recalculate_user_score', { p_user_id: user.id })
          const { data: newScores } = await supabase
            .from('user_scores')
            .select('total_score')
            .eq('user_id', user.id)
            .single()
          totalScore = newScores?.total_score || 0
        } catch (error) {
          console.warn(`[Leaderboard] Could not calculate score for user ${user.id}:`, error)
        }
      }

      const score = Math.round(totalScore)

      // Top 3 AI tools (by visits, fallback to active_ms), using domain mapping
      // Get user's recent events to calculate top tools
      const { data: userEvents } = await supabase
        .from('events_raw')
        .select('domain, visits, active_ms')
        .eq('user_id', user.id)
        .order('timestamp', { ascending: false })
        .limit(1000) // Get recent events for analysis

      const nameMap: Record<string, string> = {
        'chat.openai.com': 'ChatGPT', 'chatgpt.com': 'ChatGPT', 'openai.com': 'OpenAI',
        'claude.ai': 'Claude', 'anthropic.com': 'Claude',
        'gemini.google.com': 'Gemini', 'bard.google.com': 'Bard', 'google.com': 'Google AI',
        'perplexity.ai': 'Perplexity', 'you.com': 'You.com',
        'cursor.sh': 'Cursor', 'copilot.github.com': 'GitHub Copilot', 'github.com': 'GitHub',
        'poe.com': 'Poe', 'huggingface.co': 'Hugging Face',
        'deepseek.com': 'DeepSeek', 'www.deepseek.com': 'DeepSeek', 'chat.deepseek.com': 'DeepSeek'
      }
      const counts: Record<string, { v: number; a: number }> = {}
      for (const ev of userEvents || []) {
        const d = String(ev.domain || '').toLowerCase()
        if (!d) continue
        const key = Object.keys(nameMap).find(k => d.includes(k)) || d
        if (!counts[key]) counts[key] = { v: 0, a: 0 }
        counts[key].v += (ev.visits || (ev.active_ms ? 1 : 0))
        counts[key].a += (ev.active_ms || 0)
      }
      const visitTotal = Object.values(counts).reduce((s,v)=> s + v.v, 0)
      const topToolsDetailed = Object.entries(counts)
        .sort((a,b) => (b[1].v - a[1].v) || (b[1].a - a[1].a))
        .slice(0,3)
        .map(([k, val]) => ({ 
          name: nameMap[k] || (k.split('.')[0] || 'Unknown').replace(/\W+/g,'').slice(0,12),
          visits: val.v,
          active_ms: val.a,
          percent: visitTotal > 0 ? Math.round((val.v / visitTotal) * 100) : 0
        }))

      // Determine if user is currently active (synced within last 24 hours)
      const lastSync = user.last_extension_sync || user.user_devices?.[0]?.last_sync_at
      const isActive = lastSync ? 
        (Date.now() - new Date(lastSync).getTime()) < (24 * 60 * 60 * 1000) : false

      // Use actual subscription tier from database
      const tier = normalizeTier(user.subscription_tier)

      return {
        username: user.twitter_username || `User${user.id}`,
        display_name: user.twitter_name || user.twitter_username || `User${user.id}`,
        profile_image: user.twitter_profile_image || (user.twitter_username ? `https://unavatar.io/twitter/${user.twitter_username}?size=256` : null),
        score, // already rounded
        isActive,
        lastSeen: lastSync || user.created_at,
        tier,
        userId: user.id,
        topTools: topToolsDetailed
      }
    })

    // Wait and include all users (including zero-score), then sort
    const leaderboardData = (await Promise.all(leaderboardPromises))
      .filter((user): user is NonNullable<typeof user> => !!user)
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .map((user, idx) => ({ ...user, rank: idx + 1 })) // Add ranks after sorting

    console.log(`[Leaderboard API] Returning ${leaderboardData.length} users`) 
    return new NextResponse(JSON.stringify({ success: true, data: leaderboardData }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (err: any) {
    console.error('[Leaderboard API] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
} 