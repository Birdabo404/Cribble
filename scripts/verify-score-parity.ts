// Verifies dashboard/leaderboard score parity: compares the live score
// computation (what /api/user/me returns) against the persisted user_scores
// row (what the leaderboard reads).
//
//   npx vite-node scripts/verify-score-parity.ts          # report only
//   npx vite-node scripts/verify-score-parity.ts --fix    # recalculate stale rows
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  calculateScoreBuckets,
  fetchAllUserEvents,
  recalculateUserScore
} from '../src/lib/scoring'

function loadEnvLocal() {
  const file = path.resolve(__dirname, '../.env.local')
  const text = fs.readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

async function main() {
  loadEnvLocal()
  const fix = process.argv.includes('--fix')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: scoreRows, error } = await supabase
    .from('user_scores')
    .select('user_id, total_score, today_score, week_score, month_score, last_calculated_at')
  if (error) throw new Error(error.message)

  for (const row of scoreRows ?? []) {
    const userId = Number(row.user_id)
    const { events } = await fetchAllUserEvents(supabase, userId)
    if (!events) {
      console.log(`user ${userId}: FAILED to fetch events`)
      continue
    }
    const fresh = calculateScoreBuckets(events, new Date())
    const totalMatch = fresh.totalScore === row.total_score
    const todayMatch = fresh.todayScore === row.today_score
    const weekMatch = fresh.weekScore === row.week_score
    console.log(
      `user ${userId} (${events.length} events, persisted at ${row.last_calculated_at}):`
    )
    console.log(
      `  total: persisted=${row.total_score} live=${fresh.totalScore} ${totalMatch ? 'MATCH' : 'MISMATCH'}`
    )
    console.log(
      `  today: persisted=${row.today_score} live=${fresh.todayScore} ${todayMatch ? 'MATCH' : 'MISMATCH (expected if new events since last sync)'}`
    )
    console.log(
      `  week:  persisted=${row.week_score} live=${fresh.weekScore} ${weekMatch ? 'MATCH' : 'MISMATCH (expected if new events since last sync)'}`
    )

    if (fix && !totalMatch) {
      const { scoresStale } = await recalculateUserScore(supabase, userId)
      console.log(
        scoresStale
          ? `  fix: recalculation FAILED for user ${userId}`
          : `  fix: user_scores recalculated for user ${userId}`
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
