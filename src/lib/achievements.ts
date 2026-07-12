// Achievement catalog + pure progress logic.
//
// The catalog is code, not data: each definition owns its unlock target and
// a `current(stats)` reading, so adding an achievement is one entry here
// (plus a 12x12 pixel icon in components/achievements/pixelIcons.ts).
// Unlocks are persisted server-side in user_achievements (migration 011)
// by src/lib/achievementsServer.ts — this module stays client-safe.

import {
  normalizeLegacyEventValues,
  SCORE_POLICY,
  scoreFromEvents,
  sessionizeEvents
} from './scoring'
import { resolveToolName } from './toolNames'

export const ACHIEVEMENT_CATEGORIES = [
  'milestones',
  'streaks',
  'arsenal',
  'operations'
] as const

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number]

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary'

/** Keys into the pixel-art icon set (components/achievements/pixelIcons.ts). */
export type AchievementIcon =
  | 'flame'
  | 'rocket'
  | 'planet'
  | 'starfield'
  | 'comet'
  | 'diamond'
  | 'bolt'
  | 'terminal'
  | 'hourglass'
  | 'helmet'
  | 'chevrons'
  | 'shield'
  | 'dish'
  | 'triangle'
  | 'modules'
  | 'orbit'
  | 'plane'
  | 'radar'
  | 'eye'
  | 'infinity'
  | 'burst'
  | 'stopwatch'
  | 'wings'
  | 'crown'

/** Everything an achievement condition is allowed to read. */
export interface AchievementStats {
  totalScore: number
  /** Leaderboard position (1 = first). Null when unranked / unknown. */
  rank: number | null
  /** Best-ever run of consecutive active days. */
  longestStreak: number
  /** Lifetime count of days with any activity. */
  activeDays: number
  distinctTools: number
  totalVisits: number
  totalEvents: number
  /** Sessions at or above the deep-session threshold (10 min active). */
  deepSessions: number
  /** Highest single-day score. */
  bestDayScore: number
  /** Highest single-day active time, in ms. */
  bestDayActiveMs: number
}

export const EMPTY_ACHIEVEMENT_STATS: AchievementStats = {
  totalScore: 0,
  rank: null,
  longestStreak: 0,
  activeDays: 0,
  distinctTools: 0,
  totalVisits: 0,
  totalEvents: 0,
  deepSessions: 0,
  bestDayScore: 0,
  bestDayActiveMs: 0
}

export type AchievementUnit =
  | 'points'
  | 'days'
  | 'tools'
  | 'visits'
  | 'sessions'
  | 'duration'
  | 'none'

export interface AchievementDef {
  id: string
  name: string
  description: string
  category: AchievementCategory
  rarity: AchievementRarity
  icon: AchievementIcon
  /** Unlocks when current(stats) >= target. */
  target: number
  current: (stats: AchievementStats) => number
  /** Display unit for the progress readout; 'none' hides the bar. */
  unit: AchievementUnit
}

const HOUR_MS = 3_600_000

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- MILESTONES — lifetime score ----------------------------------
  {
    id: 'score_1k',
    name: 'IGNITION',
    description: 'Bank 1,000 lifetime points.',
    category: 'milestones',
    rarity: 'common',
    icon: 'flame',
    target: 1_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },
  {
    id: 'score_10k',
    name: 'ESCAPE VELOCITY',
    description: 'Break 10,000 lifetime points.',
    category: 'milestones',
    rarity: 'rare',
    icon: 'rocket',
    target: 10_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },
  {
    id: 'score_50k',
    name: 'ORBITAL INSERTION',
    description: 'Settle into orbit at 50,000 points.',
    category: 'milestones',
    rarity: 'rare',
    icon: 'planet',
    target: 50_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },
  {
    id: 'score_100k',
    name: 'DEEP SPACE',
    description: 'Cross 100,000 lifetime points.',
    category: 'milestones',
    rarity: 'epic',
    icon: 'starfield',
    target: 100_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },
  {
    id: 'score_250k',
    name: 'INTERSTELLAR',
    description: 'Push past 250,000 lifetime points.',
    category: 'milestones',
    rarity: 'epic',
    icon: 'comet',
    target: 250_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },
  {
    id: 'score_1m',
    name: 'MILLION MILE CLUB',
    description: 'One million lifetime points.',
    category: 'milestones',
    rarity: 'legendary',
    icon: 'diamond',
    target: 1_000_000,
    current: (s) => s.totalScore,
    unit: 'points'
  },

  // ---- STREAKS — consistency ----------------------------------------
  {
    id: 'streak_3',
    name: 'WARMING UP',
    description: 'Log activity three days in a row.',
    category: 'streaks',
    rarity: 'common',
    icon: 'bolt',
    target: 3,
    current: (s) => s.longestStreak,
    unit: 'days'
  },
  {
    id: 'streak_7',
    name: 'ALL SYSTEMS NOMINAL',
    description: 'Hold a seven-day streak.',
    category: 'streaks',
    rarity: 'rare',
    icon: 'terminal',
    target: 7,
    current: (s) => s.longestStreak,
    unit: 'days'
  },
  {
    id: 'streak_14',
    name: 'LONG HAUL',
    description: 'Hold a fourteen-day streak.',
    category: 'streaks',
    rarity: 'epic',
    icon: 'hourglass',
    target: 14,
    current: (s) => s.longestStreak,
    unit: 'days'
  },
  {
    id: 'streak_30',
    name: 'IRON PILOT',
    description: 'Hold a thirty-day streak.',
    category: 'streaks',
    rarity: 'legendary',
    icon: 'helmet',
    target: 30,
    current: (s) => s.longestStreak,
    unit: 'days'
  },
  {
    id: 'days_30',
    name: 'VETERAN',
    description: 'Thirty lifetime active days.',
    category: 'streaks',
    rarity: 'rare',
    icon: 'chevrons',
    target: 30,
    current: (s) => s.activeDays,
    unit: 'days'
  },
  {
    id: 'days_100',
    name: 'CENTURION',
    description: 'One hundred lifetime active days.',
    category: 'streaks',
    rarity: 'epic',
    icon: 'shield',
    target: 100,
    current: (s) => s.activeDays,
    unit: 'days'
  },

  // ---- ARSENAL — tools & visits -------------------------------------
  {
    id: 'first_sync',
    name: 'FIRST CONTACT',
    description: 'Sync your first session from the field.',
    category: 'arsenal',
    rarity: 'common',
    icon: 'dish',
    target: 1,
    current: (s) => s.totalEvents,
    unit: 'sessions'
  },
  {
    id: 'tools_3',
    name: 'TRIANGULATION',
    description: 'Run sessions on three different AI tools.',
    category: 'arsenal',
    rarity: 'common',
    icon: 'triangle',
    target: 3,
    current: (s) => s.distinctTools,
    unit: 'tools'
  },
  {
    id: 'tools_5',
    name: 'FULL LOADOUT',
    description: 'Run sessions on five different AI tools.',
    category: 'arsenal',
    rarity: 'rare',
    icon: 'modules',
    target: 5,
    current: (s) => s.distinctTools,
    unit: 'tools'
  },
  {
    id: 'tools_8',
    name: 'POLYGLOT',
    description: 'Run sessions on eight different AI tools.',
    category: 'arsenal',
    rarity: 'epic',
    icon: 'orbit',
    target: 8,
    current: (s) => s.distinctTools,
    unit: 'tools'
  },
  {
    id: 'visits_100',
    name: 'FREQUENT FLYER',
    description: 'Log one hundred visits across the fleet.',
    category: 'arsenal',
    rarity: 'common',
    icon: 'plane',
    target: 100,
    current: (s) => s.totalVisits,
    unit: 'visits'
  },
  {
    id: 'visits_1000',
    name: 'THOUSAND SORTIES',
    description: 'Log one thousand visits. The radar knows you.',
    category: 'arsenal',
    rarity: 'epic',
    icon: 'radar',
    target: 1_000,
    current: (s) => s.totalVisits,
    unit: 'visits'
  },

  // ---- OPERATIONS — behavior & rank ----------------------------------
  {
    id: 'deep_1',
    name: 'DEEP DIVE',
    description: 'Hold focus through a ten-minute deep session.',
    category: 'operations',
    rarity: 'common',
    icon: 'eye',
    target: 1,
    current: (s) => s.deepSessions,
    unit: 'sessions'
  },
  {
    id: 'deep_25',
    name: 'FLOW STATE',
    description: 'Bank twenty-five deep sessions.',
    category: 'operations',
    rarity: 'epic',
    icon: 'infinity',
    target: 25,
    current: (s) => s.deepSessions,
    unit: 'sessions'
  },
  {
    id: 'day_1k',
    name: 'SUPERNOVA',
    description: 'Score 1,000+ points in a single day.',
    category: 'operations',
    rarity: 'rare',
    icon: 'burst',
    target: 1_000,
    current: (s) => s.bestDayScore,
    unit: 'points'
  },
  {
    id: 'marathon_4h',
    name: 'MARATHON',
    description: 'Four hours of active time in one day.',
    category: 'operations',
    rarity: 'epic',
    icon: 'stopwatch',
    target: 4 * HOUR_MS,
    current: (s) => s.bestDayActiveMs,
    unit: 'duration'
  },
  {
    id: 'rank_top10',
    name: 'SQUADRON LEADER',
    description: 'Break into the leaderboard top ten.',
    category: 'operations',
    rarity: 'epic',
    icon: 'wings',
    target: 1,
    current: (s) => (s.rank !== null && s.rank <= 10 ? 1 : 0),
    unit: 'none'
  },
  {
    id: 'rank_1',
    name: 'APEX',
    description: 'Take the number one spot on the leaderboard.',
    category: 'operations',
    rarity: 'legendary',
    icon: 'crown',
    target: 1,
    current: (s) => (s.rank !== null && s.rank <= 1 ? 1 : 0),
    unit: 'none'
  }
]

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((def) => [def.id, def])
)

export function isAchievementUnlocked(
  def: AchievementDef,
  stats: AchievementStats
): boolean {
  return def.current(stats) >= def.target
}

export function unlockedAchievementIds(stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((def) => isAchievementUnlocked(def, stats)).map(
    (def) => def.id
  )
}

// --------------------------------------------------------------------
// Stats computation from raw events
// --------------------------------------------------------------------

export interface AchievementEvent {
  timestamp?: string | null
  domain?: string | null
  active_ms?: number | null
  total_ms?: number | null
  visits?: number | null
}

const DAY_MS = 86_400_000

function dayKeyUtc(iso: string): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString().split('T')[0]
}

/** Longest run of consecutive UTC days among the given active-day keys. */
export function longestStreakFromDayKeys(dayKeys: Iterable<string>): number {
  const days = [...new Set(dayKeys)]
    .map((key) => Date.parse(`${key}T00:00:00.000Z`))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)

  let longest = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] - days[i - 1] === DAY_MS ? run + 1 : 1
    if (run > longest) longest = run
  }
  return longest
}

export function computeAchievementStats(
  events: AchievementEvent[],
  context: { totalScore: number; rank: number | null }
): AchievementStats {
  const dayEvents: Record<string, AchievementEvent[]> = {}
  const dayActiveMs: Record<string, number> = {}
  const tools = new Set<string>()

  let totalVisits = 0

  for (const event of events) {
    const normalized = normalizeLegacyEventValues(event)
    totalVisits += normalized.visits

    const domain = String(event.domain || '').trim()
    if (domain) tools.add(resolveToolName(domain))

    const key = dayKeyUtc(String(event.timestamp || ''))
    if (key) {
      if (!dayEvents[key]) dayEvents[key] = []
      dayEvents[key].push(event)
      dayActiveMs[key] = (dayActiveMs[key] || 0) + normalized.activeMs
    }
  }

  // Deep sessions are real engagement sessions (contiguous same-domain
  // activity), not single rows — rows are ~5s heartbeats, so a per-row
  // check could never reach the 10-minute threshold.
  const deepSessions = sessionizeEvents(events).filter(
    (session) => session.activeMs >= SCORE_POLICY.deepSessionThresholdMs
  ).length

  const dayScore: Record<string, number> = {}
  for (const [key, dayGroup] of Object.entries(dayEvents)) {
    dayScore[key] = scoreFromEvents(dayGroup)
  }

  const activeDayKeys = Object.keys(dayScore).filter((key) => dayScore[key] > 0)

  return {
    totalScore: Math.max(0, Math.round(context.totalScore)),
    rank: context.rank,
    longestStreak: longestStreakFromDayKeys(activeDayKeys),
    activeDays: activeDayKeys.length,
    distinctTools: tools.size,
    totalVisits,
    totalEvents: events.length,
    deepSessions,
    bestDayScore: Math.round(Math.max(0, ...Object.values(dayScore))),
    bestDayActiveMs: Math.max(0, ...Object.values(dayActiveMs))
  }
}
