// Static preview data for the landing-page descent. Everything is
// deterministic (no Math.random at module/render scope) so SSR and client
// hydration always agree; the live simulations mutate copies client-side.

import { ACHIEVEMENTS, type AchievementDef } from '@/lib/achievements'

/* ------------------------------------------------------------------ */
/* Arena — simulated standings                                         */
/* ------------------------------------------------------------------ */

export interface SimPilot {
  id: string
  /** X handle — the arena roster is a staged lineup of real X accounts. */
  callsign: string
  name: string
  org: string
  score: number
  today: number
  tool: string
  online: boolean
  /** Real plate id from the cosmetics catalog, rendered via PlateLayer. */
  plate: string | null
  /** Relative win-rate weight for the score-gain simulation. */
  heat: number
}

export const SIM_ROSTER: SimPilot[] = [
  {
    id: 'p1',
    callsign: '@Birdabo',
    name: 'Birdabo',
    org: 'CRIBBLE',
    score: 412_806,
    today: 4_218,
    tool: 'Cursor',
    online: true,
    plate: 'champions-gold',
    heat: 3
  },
  {
    id: 'p2',
    callsign: '@sama',
    name: 'Sam Altman',
    org: 'OPENAI',
    score: 409_774,
    today: 5_102,
    tool: 'ChatGPT',
    online: true,
    plate: null,
    heat: 4
  },
  {
    id: 'p3',
    callsign: '@elonmusk',
    name: 'Elon Musk',
    org: 'XAI',
    score: 408_116,
    today: 6_040,
    tool: 'Grok',
    online: true,
    plate: 'synthwave-grid',
    heat: 4
  },
  {
    id: 'p4',
    callsign: '@karpathy',
    name: 'Andrej Karpathy',
    org: 'EUREKA',
    score: 361_240,
    today: 2_871,
    tool: 'Claude',
    online: true,
    plate: 'terminal-rain',
    heat: 3
  },
  {
    id: 'p5',
    callsign: '@mntruell',
    name: 'Michael Truell',
    org: 'CURSOR',
    score: 359_842,
    today: 3_960,
    tool: 'Cursor',
    online: true,
    plate: null,
    heat: 3
  },
  {
    id: 'p6',
    callsign: '@naval',
    name: 'Naval',
    org: 'ANGELLIST',
    score: 287_415,
    today: 980,
    tool: 'Perplexity',
    online: false,
    plate: null,
    heat: 1
  }
]

export const ARENA_STATS = [
  { label: 'PILOTS', value: 2_104, format: 'number' as const },
  { label: 'ONLINE NOW', value: 318, format: 'number' as const, live: true },
  { label: 'TOP SCORE', value: 412_806, format: 'score' as const },
  { label: 'SEASON ENDS', value: 41, format: 'days' as const }
]

/* ------------------------------------------------------------------ */
/* Cockpit — dashboard mock                                            */
/* ------------------------------------------------------------------ */

export const COCKPIT = {
  score: 84_209,
  rank: 47,
  rankDelta: 3,
  gain24h: 2_418,
  gain7d: 9_051,
  streakDays: 12,
  seasonPct: 54,
  seasonDaysLeft: 41,
  kpis: [
    { label: 'VISITS', value: '1,284' },
    { label: 'ACTIVE TIME', value: '96H 12M' },
    { label: 'EFFICIENCY', value: '87%' },
    { label: 'FOCUS TODAY', value: '3H 41M' }
  ],
  tools: [
    { name: 'Cursor', pct: 34 },
    { name: 'ChatGPT', pct: 27 },
    { name: 'Claude', pct: 21 },
    { name: 'Gemini', pct: 11 },
    { name: 'Perplexity', pct: 7 }
  ],
  /** Normalized sparkline samples, oldest → newest. */
  spark: [12, 18, 15, 26, 22, 34, 30, 44, 39, 52, 61, 55, 72, 68, 84, 92]
}

export const SYNC_FEED = [
  { site: 'cursor.com', note: 'deep session · 41m', pts: 212 },
  { site: 'claude.ai', note: 'opus · long context', pts: 148 },
  { site: 'chatgpt.com', note: '14 prompts', pts: 96 },
  { site: 'gemini.google.com', note: 'code review', pts: 71 },
  { site: 'perplexity.ai', note: 'research run', pts: 44 }
]

/** Deterministic 12×7 activity heatmap intensity (0–4). Weekdays run a
 * little hotter than weekends; a Knuth-hash wobble keeps it organic. */
export function heatLevel(week: number, day: number): number {
  const i = week * 7 + day
  const h = (i * 2654435761) % 97
  const weekday = day > 0 && day < 6 ? 1 : 0
  const ramp = week / 11 // the story: usage climbing across the quarter
  const v = (h / 97) * 2.2 + weekday * 0.9 + ramp * 1.6
  return Math.max(0, Math.min(4, Math.floor(v)))
}

/* ------------------------------------------------------------------ */
/* Identity — plate showcase (real catalog ids)                        */
/* ------------------------------------------------------------------ */

export const SHOWCASE_PLATES = [
  'synthwave-grid',
  'terminal-rain',
  'koi-pond',
  'champions-gold'
] as const

/* ------------------------------------------------------------------ */
/* Honors — real achievement catalog, APEX pulled out as the finale    */
/* ------------------------------------------------------------------ */

export const HONOR_TILES: AchievementDef[] = ACHIEVEMENTS.filter(
  (a) => a.id !== 'rank_1'
)

export const APEX: AchievementDef = ACHIEVEMENTS.find(
  (a) => a.id === 'rank_1'
)!

export const RARITY_COLOR: Record<string, string> = {
  common: 'rgb(var(--r-common))',
  rare: 'rgb(var(--r-rare))',
  epic: 'rgb(var(--r-epic))',
  legendary: 'rgb(var(--r-legendary))'
}

/* ------------------------------------------------------------------ */
/* Roadmap                                                             */
/* ------------------------------------------------------------------ */

export interface RoadmapItem {
  title: string
  detail: string
}

export interface RoadmapPhase {
  phase: string
  code: string
  status: 'LIVE' | 'CHARTED' | 'R&D'
  headline: string
  items: RoadmapItem[]
}

export const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    phase: 'PHASE 01',
    code: 'IN ORBIT',
    status: 'LIVE',
    headline: 'The browser fleet, fully instrumented.',
    items: [
      {
        title: 'Global + AI leaderboards',
        detail: 'Live standings across every ranked pilot, and a second board ranking the tools themselves.'
      },
      {
        title: 'Silent extension · 47 AI domains',
        detail: 'ChatGPT, Claude, Cursor, Gemini, Perplexity and the rest — tallied without a sound.'
      },
      {
        title: 'Profiles, plates & 25 medals',
        detail: 'Trading-card profiles, equippable nameplates, a service record earned from real usage.'
      },
      {
        title: 'Season 01: Ignition',
        detail: 'Quarterly resets with seasonal drops. The first checkered flag is already flying.'
      }
    ]
  },
  {
    phase: 'PHASE 02',
    code: 'ATMOSPHERE',
    status: 'CHARTED',
    headline: 'The competition gets organized.',
    items: [
      {
        title: 'Squads',
        detail: 'Team standings for companies, collectives and group chats. Your squad average is your reputation.'
      },
      {
        title: 'Season 02 + shop drops',
        detail: 'New medal lines, retired plates staying retired, and drops worth logging on for.'
      }
    ]
  },
  {
    phase: 'PHASE 03',
    code: 'GROUND OPS',
    status: 'R&D',
    headline: 'Agent telemetry. The terminal counts too.',
    items: []
  }
]

/** The agent-tracker terminal script, typed line by line. */
export const AGENT_TERMINAL_LINES = [
  { text: '$ cribble agent --attach', tone: 'cmd' as const },
  { text: '▲ CRIBBLE AGENT TELEMETRY v0.1 · experimental build', tone: 'sys' as const },
  { text: 'scanning local processes … 4 agents found', tone: 'sys' as const },
  { text: '● cursor         composer · 2 tabs · 41m', tone: 'row' as const, pts: 618 },
  { text: '● claude code    opus · 128k ctx · 8 tool calls', tone: 'row' as const, pts: 402 },
  { text: '● codex          3 parallel runs · sandboxed', tone: 'row' as const, pts: 377 },
  { text: '○ windsurf       idle · last seen 2h ago', tone: 'dim' as const },
  { text: 'SESSION TOTAL    1,397 pts → syncing to global board', tone: 'total' as const }
]

export const AGENT_CHIPS = [
  { name: 'Cursor', icon: 'Cursor' },
  { name: 'Claude Code', icon: 'Claude' },
  { name: 'Codex', icon: 'ChatGPT' },
  { name: 'Windsurf', icon: 'Windsurf' },
  { name: 'Gemini CLI', icon: 'Gemini' }
]
