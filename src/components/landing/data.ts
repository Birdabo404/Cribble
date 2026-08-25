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
  /** Local avatar asset mirrored from the pilot's X profile. */
  avatar?: string
}

// Score scale carries the house numbers (92 · 29 · 369 · 9:44) without
// breaking the sim: relative gaps between rivals match the tuning the
// tick logic was balanced against, so the duels play out the same.

const BIRDABO: SimPilot = {
  id: 'p1',
  callsign: '@birdabo',
  name: 'Birdabo',
  org: 'CRIBBLE',
  score: 929_369,
  today: 9_440,
  tool: 'Cursor',
  online: true,
  plate: 'champions-gold',
  heat: 3,
  avatar: '/avatars/birdabo.jpg'
}

const KARPATHY: SimPilot = {
  id: 'p4',
  callsign: '@karpathy',
  name: 'Andrej Karpathy',
  org: 'EUREKA',
  score: 877_803,
  today: 2_871,
  tool: 'Claude',
  online: true,
  plate: 'terminal-rain',
  heat: 3,
  avatar: '/avatars/karpathy.jpg'
}

// The insurgents — indie hackers who storm the board during the takeover.
// Each score is tuned to land exactly one slot above their victim.

const LEVELSIO: SimPilot = {
  id: 'n1',
  callsign: '@levelsio',
  name: 'Pieter Levels',
  org: 'NOMADS',
  score: 927_929,
  today: 6_929,
  tool: 'Grok',
  online: true,
  plate: 'synthwave-grid',
  heat: 4,
  avatar: '/avatars/levelsio.jpg'
}

const MARC_LOU: SimPilot = {
  id: 'n2',
  callsign: '@marc_louvion',
  name: 'Marc Lou',
  org: 'SHIPFAST',
  score: 925_444,
  today: 5_369,
  tool: 'ChatGPT',
  online: true,
  plate: null,
  heat: 4,
  avatar: '/avatars/marc_louvion.jpg'
}

const JACK_FRIKS: SimPilot = {
  id: 'n3',
  callsign: '@jackfriks',
  name: 'Jack Friks',
  org: 'POSTBRIDGE',
  score: 877_369,
  today: 4_292,
  tool: 'Claude',
  online: true,
  plate: null,
  heat: 3,
  avatar: '/avatars/jackfriks.jpg'
}

const ROBJ3D3: SimPilot = {
  id: 'n4',
  callsign: '@robj3d3',
  name: 'Rob Hallam',
  org: 'SUPERX',
  score: 805_929,
  today: 2_944,
  tool: 'Cursor',
  online: true,
  plate: null,
  heat: 2,
  avatar: '/avatars/robj3d3.jpg'
}

/** The board's end state — what SSR, no-JS and reduced-motion render, and
 * where the takeover choreography lands when motion is allowed. */
export const SIM_ROSTER: SimPilot[] = [
  BIRDABO,
  LEVELSIO,
  MARC_LOU,
  KARPATHY,
  JACK_FRIKS,
  ROBJ3D3
]

/** Opening lineup when the takeover plays: the old guard, still holding
 * ranks they're about to lose. */
export const TAKEOVER_START: SimPilot[] = [
  BIRDABO,
  {
    id: 'p2',
    callsign: '@sama',
    name: 'Sam Altman',
    org: 'OPENAI',
    score: 926_337,
    today: 5_102,
    tool: 'ChatGPT',
    online: true,
    plate: null,
    heat: 4,
    avatar: '/avatars/sama.jpg'
  },
  {
    id: 'p3',
    callsign: '@elonmusk',
    name: 'Elon Musk',
    org: 'XAI',
    score: 924_679,
    today: 6_040,
    tool: 'Grok',
    online: true,
    plate: 'synthwave-grid',
    heat: 4,
    avatar: '/avatars/elonmusk.jpg'
  },
  KARPATHY,
  {
    id: 'p5',
    callsign: '@mntruell',
    name: 'Michael Truell',
    org: 'CURSOR',
    score: 876_405,
    today: 3_960,
    tool: 'Cursor',
    online: true,
    plate: null,
    heat: 3,
    avatar: '/avatars/mntruell.jpg'
  },
  {
    id: 'p6',
    callsign: '@naval',
    name: 'Naval',
    org: 'ANGELLIST',
    score: 803_978,
    today: 980,
    tool: 'Perplexity',
    online: false,
    plate: null,
    heat: 1,
    avatar: '/avatars/naval.jpg'
  }
]

/** Scripted arrivals, lowest rank first so every hit reads clearly. Each
 * newcomer warps in one slot above their victim; the victim deranks, then
 * falls off the board. Ends exactly on SIM_ROSTER. */
export const TAKEOVER_EVENTS: { enter: SimPilot; drop: string }[] = [
  { enter: ROBJ3D3, drop: 'p6' }, //   805,929 over naval    · 803,978
  { enter: JACK_FRIKS, drop: 'p5' }, // 877,369 over mntruell · 876,405
  { enter: MARC_LOU, drop: 'p3' }, //  925,444 over elonmusk · 924,679
  { enter: LEVELSIO, drop: 'p2' } //   927,929 over sama     · 926,337
]

export const ARENA_STATS = [
  { label: 'PILOTS', value: 2_929, format: 'number' as const },
  { label: 'ONLINE NOW', value: 369, format: 'number' as const, live: true },
  { label: 'TOP SCORE', value: 929_369, format: 'score' as const },
  { label: 'SEASON ENDS', value: 29, format: 'days' as const }
]

/* ------------------------------------------------------------------ */
/* Cockpit — dashboard mock                                            */
/* ------------------------------------------------------------------ */

export const COCKPIT = {
  score: 92_369,
  rank: 29,
  rankDelta: 3,
  gain24h: 2_944,
  gain7d: 9_369,
  streakDays: 29,
  seasonDaysLeft: 29,
  kpis: [
    { label: 'VISITS', value: '1,369' },
    { label: 'ACTIVE TIME', value: '92H 29M' },
    { label: 'DEEP SESSIONS', value: '29' },
    { label: 'FOCUS TODAY', value: '9H 44M' }
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
  { site: 'cursor.com', note: 'deep session · 44m', pts: 292 },
  { site: 'claude.ai', note: 'opus · long context', pts: 144 },
  { site: 'chatgpt.com', note: '29 prompts', pts: 92 },
  { site: 'gemini.google.com', note: 'code review', pts: 69 },
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
  legendary: 'rgb(var(--r-legendary))',
  mythic: 'rgb(var(--r-mythic))'
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
        detail: 'Live standings for every ranked pilot, plus a second board where the tools themselves fight it out.'
      },
      {
        title: 'Silent extension · 47 AI domains',
        detail: 'ChatGPT, Claude, Cursor, Gemini, Perplexity and the rest, tallied without a sound.'
      },
      {
        title: 'Profiles, plates & 32 medals',
        detail: 'Trading-card profiles, equippable nameplates, and a service record no credit card can shortcut.'
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
        detail: "Company vs company, group chat vs group chat. Your squad's average becomes everyone's problem."
      },
      {
        title: 'Season 02 + shop drops',
        detail: 'New medal lines and fresh plates. Retired ones stay retired. Scarcity is the point.'
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

/** The agent-tracker terminal script, typed line by line.
 * Row points sum to the printed session total: 629 + 448 + 292 = 1,369. */
export const AGENT_TERMINAL_LINES = [
  { text: '$ cribble agent --attach', tone: 'cmd' as const },
  { text: '▲ CRIBBLE AGENT TELEMETRY v0.1 · experimental build', tone: 'sys' as const },
  { text: 'scanning local processes … 4 agents found', tone: 'sys' as const },
  { text: '● cursor         composer · 2 tabs · 44m', tone: 'row' as const, pts: 629 },
  { text: '● claude code    opus · 128k ctx · 8 tool calls', tone: 'row' as const, pts: 448 },
  { text: '● codex          3 parallel runs · sandboxed', tone: 'row' as const, pts: 292 },
  { text: '○ windsurf       idle · last seen 2h ago', tone: 'dim' as const },
  { text: 'SESSION TOTAL    1,369 pts → syncing to global board', tone: 'total' as const }
]

export const AGENT_CHIPS = [
  { name: 'Cursor', icon: 'Cursor' },
  { name: 'Claude Code', icon: 'Claude' },
  { name: 'Codex', icon: 'ChatGPT' },
  { name: 'Windsurf', icon: 'Windsurf' },
  { name: 'Gemini CLI', icon: 'Gemini' }
]
