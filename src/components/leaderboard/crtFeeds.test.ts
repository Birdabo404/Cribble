import { describe, expect, it } from 'vitest'
import type { CursorBoardRow } from '@/lib/cursorProfileBoard'
import {
  formatApproxUsd,
  formatApproxUsdNumber,
  type TokenBoardRow
} from '@/lib/tokenLeaderboard'
import {
  cliDossier,
  cursorDossier,
  cursorProfileUrl,
  delta,
  pilotDossier,
  serial
} from './crtFeeds'
import type { LeaderRow } from './types'

const NO_SIGNAL = '——'

function leaderRow(partial: Partial<LeaderRow> = {}): LeaderRow {
  return {
    userId: 1234,
    rank: 1,
    username: 'birdabo',
    display_name: 'Birdabo',
    profile_image: 'https://pbs.twimg.com/birdabo.jpg',
    score: 42_000,
    todayScore: 1_500,
    weekScore: 12_000,
    isActive: true,
    lastSeen: null,
    tier: 'PRO',
    topTools: [{ name: 'Cursor', visits: 10, active_ms: 1_000, percent: 63 }],
    rankDelta: 0,
    movedAt: null,
    isNew: false,
    ...partial
  }
}

function tokenRow(partial: Partial<TokenBoardRow> = {}): TokenBoardRow {
  return {
    userId: 77,
    rank: 2,
    username: 'burner',
    displayName: 'Big Burner',
    profileImage: 'https://pbs.twimg.com/burner.jpg',
    tier: null,
    team: null,
    inputTokens: '1000',
    outputTokens: '500',
    cacheCreationTokens: '0',
    cacheReadTokens: '0',
    cacheTokens: '0',
    totalTokens: '1234567890',
    burnUsd: '1234.5',
    cachePercent: 41.6,
    activeDays: 12,
    clientCount: 1,
    agents: ['claude-code'],
    models: ['claude-sonnet-4'],
    lastSyncedAt: null,
    topAgent: 'claude-code',
    topAgentDays: 12,
    topModel: 'claude-sonnet-4',
    topModelDays: 12,
    topAgentTokens: '1234567890',
    topModelTokens: '1234567890',
    agentBreakdown: [],
    modelBreakdown: [],
    agentBreakdownComplete: true,
    modelBreakdownComplete: true,
    timezoneComplete: true,
    provisional: false,
    persona: { id: 'whale', label: 'WHALE', tone: 'danger' },
    ...partial
  }
}

function cursorRow(partial: Partial<CursorBoardRow> = {}): CursorBoardRow {
  return {
    rank: 3,
    userId: 9001,
    username: 'pilot',
    cursorUsername: 'pilot.dev',
    displayName: 'Pilot Dev',
    avatarUrl: 'https://cursor.com/pilot.png',
    tokens: '1200000',
    agentsLocal: 900,
    agentsCloud: 334,
    currentStreak: 12,
    longestStreak: 30,
    longestAgentSeconds: 3_600,
    topModels: ['claude-4-sonnet', 'gpt-5'],
    tier: null,
    team: null,
    ...partial
  }
}

describe('delta', () => {
  it('prints a signed compact gain', () => {
    expect(delta(5)).toBe('+5')
    expect(delta(1_500)).toBe('+1.5k')
    expect(delta(12_000)).toBe('+12k')
    expect(delta(2_500_000)).toBe('+2.5M')
  })

  it('reads zero or a loss as no signal', () => {
    expect(delta(0)).toBe(NO_SIGNAL)
    expect(delta(-40)).toBe(NO_SIGNAL)
  })
})

describe('serial', () => {
  it('prints the user id in upper-case base-36 behind the PLT. prefix', () => {
    expect(serial(0)).toBe('PLT.0000')
    expect(serial(35)).toBe('PLT.000Z')
    expect(serial(1234)).toBe('PLT.00YA')
    expect(serial(36 ** 4 - 1)).toBe('PLT.ZZZZ')
  })

  it('grows past four digits rather than truncating', () => {
    expect(serial(36 ** 4)).toBe('PLT.10000')
  })
})

describe('pilotDossier', () => {
  it('reproduces the GLOBAL attract-mode dossier byte for byte', () => {
    const dossier = pilotDossier(leaderRow(), 84_000)
    expect(dossier).toEqual({
      key: 1234,
      rank: 1,
      name: 'Birdabo',
      handle: 'birdabo',
      avatar: { url: 'https://pbs.twimg.com/birdabo.jpg', handle: 'birdabo' },
      roster: 'PILOT',
      status: { label: 'ONLINE', on: true },
      bars: [
        { k: '24H', v: '+1.5k' },
        { k: 'TOOL', v: 'CURSOR 63%' }
      ],
      codes: [
        { k: '7D', v: '+12k' },
        { k: 'ID', v: 'PLT.00YA' }
      ],
      figure: { label: 'SCORE', value: 42_000, format: expect.any(Function) },
      bar: { label: 'PWR', frac: 0.5 },
      seed: 1234,
      hint: 'PRESS START ─ OPEN PILOT CARD',
      aria: 'Open pilot card — @birdabo, rank 1'
    })
    expect(dossier.figure.format(42_000)).toBe('42,000')
  })

  it('rounds tween frames before grouping the score', () => {
    const { figure } = pilotDossier(leaderRow(), 84_000)
    expect(figure.format(41_999.6)).toBe('42,000')
    expect(figure.format(0)).toBe('0')
  })

  it('falls back to the @handle when the display name is empty', () => {
    expect(pilotDossier(leaderRow({ display_name: '' }), 1).name).toBe('@birdabo')
  })

  it('reads an offline pilot with the lamp off', () => {
    expect(pilotDossier(leaderRow({ isActive: false }), 1).status).toEqual({
      label: 'OFFLINE',
      on: false
    })
  })

  it('prints no-signal dashes for zero deltas and a missing top tool', () => {
    const quiet = pilotDossier(
      leaderRow({ todayScore: 0, weekScore: 0, topTools: [] }),
      84_000
    )
    expect(quiet.bars).toEqual([
      { k: '24H', v: NO_SIGNAL },
      { k: 'TOOL', v: NO_SIGNAL }
    ])
    expect(quiet.codes[0]).toEqual({ k: '7D', v: NO_SIGNAL })

    const privateRow = pilotDossier(leaderRow({ topTools: undefined }), 84_000)
    expect(privateRow.bars[1]).toEqual({ k: 'TOOL', v: NO_SIGNAL })
  })

  it('fills the PWR bar as a share of the top score, clamped', () => {
    expect(pilotDossier(leaderRow({ score: 21_000 }), 84_000).bar.frac).toBe(0.25)
    expect(pilotDossier(leaderRow({ score: 84_000 }), 84_000).bar.frac).toBe(1)
    expect(pilotDossier(leaderRow({ score: 90_000 }), 84_000).bar.frac).toBe(1)
    expect(pilotDossier(leaderRow(), 0).bar.frac).toBe(0)
  })
})

describe('formatApproxUsd', () => {
  it('renders the ladder with its own currency mark', () => {
    expect(formatApproxUsd(0)).toBe('$0.00')
    expect(formatApproxUsd(0.004)).toBe('<$0.01')
    expect(formatApproxUsd(0.01)).toBe('$0.01')
    expect(formatApproxUsd(123.45)).toBe('$123.45')
    // Whole dollars from $1,000 — the board's usdDisplayParts convention.
    expect(formatApproxUsd(1234.5)).toBe('$1,235')
    expect(formatApproxUsd(12_345)).toBe('$12,345')
    expect(formatApproxUsd(250_000)).toBe('$250k')
    expect(formatApproxUsd(1_500_000)).toBe('$1.5M')
  })

  it('reads negative and non-finite input as nothing burned', () => {
    expect(formatApproxUsd(-3)).toBe('$0.00')
    expect(formatApproxUsd(NaN)).toBe('$0.00')
    expect(formatApproxUsd(Infinity)).toBe('$0.00')
  })

  it('formatApproxUsdNumber is the bare digits the board wraps in its own mark', () => {
    expect(formatApproxUsdNumber(0)).toBe('0.00')
    expect(formatApproxUsdNumber(0.004)).toBe('0.00')
    expect(formatApproxUsdNumber(123.45)).toBe('123.45')
    expect(formatApproxUsdNumber(1234.5)).toBe('1,235')
    expect(formatApproxUsdNumber(250_000)).toBe('250k')
  })
})

describe('cliDossier', () => {
  it('maps a CLI burn row onto a burner dossier', () => {
    const dossier = cliDossier(tokenRow(), '2469')
    expect(dossier).toEqual({
      key: 77,
      rank: 2,
      name: 'Big Burner',
      handle: 'burner',
      avatar: { url: 'https://pbs.twimg.com/burner.jpg', handle: 'burner' },
      roster: 'BURNER',
      status: { label: 'WHALE', on: true },
      bars: [
        { k: 'AGENT', v: 'CLAUDE CODE' },
        { k: 'TOKENS', v: '1.23B' }
      ],
      codes: [
        { k: 'CACHE', v: '42%' },
        { k: 'DAYS', v: '012' }
      ],
      // The figure counts in cents: the tube snaps the tween to whole units.
      figure: { label: 'EST.BURN', value: 123_450, format: expect.any(Function) },
      bar: { label: 'FUEL', frac: 0.5 },
      seed: 77,
      hint: 'PRESS START ─ OPEN BURN CARD',
      aria: 'Open burn card — @burner, rank 2'
    })
  })

  it('formats the EST.BURN figure from cents through the shared USD ladder, upper-cased', () => {
    const { figure } = cliDossier(tokenRow(), '2469')
    expect(figure.format(0)).toBe('$0.00')
    expect(figure.format(1)).toBe('$0.01')
    expect(figure.format(12_345)).toBe('$123.45')
    expect(figure.format(123_456)).toBe('$1,235')
    expect(figure.format(1_234_500)).toBe('$12,345')
    expect(figure.format(25_000_000)).toBe('$250K')
    expect(figure.format(150_000_000)).toBe('$1.5M')
  })

  it('lands the final frame on the row\u2019s exact burn', () => {
    const exact = cliDossier(tokenRow({ burnUsd: '123.45' }), '1').figure
    expect(exact.value).toBe(12_345)
    expect(exact.format(exact.value)).toBe('$123.45')
    // Fractional cents in the wire value round to the nearest cent.
    expect(cliDossier(tokenRow({ burnUsd: '0.015' }), '1').figure.value).toBe(2)
    expect(cliDossier(tokenRow({ burnUsd: '0' }), '1').figure.value).toBe(0)
  })

  it('pins a sub-cent burn to <$0.01 for the whole count', () => {
    const { figure, bar } = cliDossier(tokenRow({ burnUsd: '0.004' }), '100')
    expect(figure.value).toBe(0)
    expect(figure.format(0)).toBe('<$0.01')
    expect(figure.format(figure.value)).toBe('<$0.01')
    // …while the FUEL bar still measures the true (tiny) share.
    expect(bar.frac).toBeCloseTo(0.00004)
  })

  it('reads a zero burn as $0.00, not as a trickle', () => {
    const { figure } = cliDossier(tokenRow({ burnUsd: '0' }), '100')
    expect(figure.format(figure.value)).toBe('$0.00')
  })

  it('upper-cases compact token units for the tube', () => {
    expect(cliDossier(tokenRow({ totalTokens: '4500' }), '1').bars[1]).toEqual({
      k: 'TOKENS',
      v: '4.5K'
    })
    expect(cliDossier(tokenRow({ totalTokens: '1200000' }), '1').bars[1].v).toBe('1.2M')
    expect(cliDossier(tokenRow({ totalTokens: '999' }), '1').bars[1].v).toBe('999')
  })

  it('labels the agent, with MIXED for a multi-agent row and dashes for none', () => {
    const agent = (row: TokenBoardRow) => cliDossier(row, '1').bars[0].v
    expect(agent(tokenRow({ topAgent: 'codex' }))).toBe('CODEX')
    expect(agent(tokenRow({ topAgent: 'some-new-harness' }))).toBe('SOME NEW HARNESS')
    expect(agent(tokenRow({ topAgent: null, agents: ['claude-code', 'codex'] }))).toBe('MIXED')
    expect(agent(tokenRow({ topAgent: null, agents: ['claude-code'] }))).toBe(NO_SIGNAL)
    expect(agent(tokenRow({ topAgent: null, agents: [] }))).toBe(NO_SIGNAL)
  })

  it('rounds the cache share and zero-pads active days', () => {
    const dossier = cliDossier(tokenRow({ cachePercent: 99.5, activeDays: 7 }), '1')
    expect(dossier.codes).toEqual([
      { k: 'CACHE', v: '100%' },
      { k: 'DAYS', v: '007' }
    ])
  })

  it('lights the lamp only for spend-tier personas', () => {
    expect(cliDossier(tokenRow({ persona: { id: 'whale', label: 'WHALE', tone: 'danger' } }), '1').status)
      .toEqual({ label: 'WHALE', on: true })
    expect(
      cliDossier(
        tokenRow({ persona: { id: 'compute-baron', label: 'COMPUTE BARON', tone: 'danger' } }),
        '1'
      ).status
    ).toEqual({ label: 'COMPUTE BARON', on: true })
    expect(
      cliDossier(tokenRow({ persona: { id: 'small-fire', label: 'Small Fire', tone: 'neutral' } }), '1')
        .status
    ).toEqual({ label: 'SMALL FIRE', on: false })
    expect(
      cliDossier(tokenRow({ persona: { id: 'yapper', label: 'YAPPER', tone: 'output' } }), '1').status
    ).toEqual({ label: 'YAPPER', on: false })
  })

  it('fills the FUEL bar as a share of the leader burn, clamped and zero-guarded', () => {
    expect(cliDossier(tokenRow({ burnUsd: '50' }), '100').bar.frac).toBe(0.5)
    expect(cliDossier(tokenRow({ burnUsd: '100' }), '100').bar.frac).toBe(1)
    expect(cliDossier(tokenRow({ burnUsd: '150' }), '100').bar.frac).toBe(1)
    expect(cliDossier(tokenRow({ burnUsd: '0' }), '100').bar.frac).toBe(0)
    expect(cliDossier(tokenRow({ burnUsd: '50' }), '0').bar.frac).toBe(0)
  })
})

describe('cursorDossier', () => {
  it('maps a cursor.com row onto a burner dossier keyed by the claimed handle', () => {
    const dossier = cursorDossier(cursorRow(), '2400000')
    expect(dossier).toEqual({
      key: 9001,
      rank: 3,
      name: 'Pilot Dev',
      handle: 'pilot.dev',
      // Portrait: the cursor.com avatar, refreshed (if dead) by the Cribble
      // handle — avatarUrl falls back to the Cribble/X profile image.
      avatar: { url: 'https://cursor.com/pilot.png', handle: 'pilot' },
      roster: 'BURNER',
      status: { label: 'STREAK 12D', on: true },
      bars: [
        { k: 'MODEL', v: 'CLAUDE-4-SONNET' },
        { k: 'AGENTS', v: '1,234' }
      ],
      codes: [
        { k: 'LOCAL', v: '900' },
        { k: 'CLOUD', v: '334' }
      ],
      figure: { label: 'TOKENS', value: 1_200_000, format: expect.any(Function) },
      bar: { label: 'FUEL', frac: 0.5 },
      seed: 9001,
      hint: 'PRESS START ─ OPEN CURSOR.COM PROFILE',
      aria: 'Open cursor.com profile — @pilot.dev, rank 3'
    })
  })

  it('shows the cursor.com handle but refreshes the portrait by the Cribble one', () => {
    const dossier = cursorDossier(
      cursorRow({
        username: 'xhandle',
        cursorUsername: 'someone.else',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1/xhandle.jpg'
      }),
      '1'
    )
    expect(dossier.handle).toBe('someone.else')
    expect(dossier.avatar).toEqual({
      url: 'https://pbs.twimg.com/profile_images/1/xhandle.jpg',
      handle: 'xhandle'
    })
    expect(dossier.aria).toBe('Open cursor.com profile — @someone.else, rank 3')
  })

  it('formats the TOKENS figure compact and upper-case from rounded frames', () => {
    const { figure } = cursorDossier(cursorRow(), '1')
    expect(figure.format(1_200_000)).toBe('1.2M')
    expect(figure.format(1_234_567_890)).toBe('1.23B')
    expect(figure.format(4_500)).toBe('4.5K')
    expect(figure.format(999.4)).toBe('999')
    expect(figure.format(0)).toBe('0')
    expect(figure.format(-5)).toBe('0')
  })

  it('approximates a token count past the safe-integer range instead of dropping it', () => {
    const huge = cursorDossier(cursorRow({ tokens: '99999999999999999999' }), '99999999999999999999')
    expect(huge.figure.value).toBe(1e20)
    expect(huge.bar.frac).toBe(1)
  })

  it('reads the streak lamp from the current streak', () => {
    expect(cursorDossier(cursorRow({ currentStreak: 1_234 }), '1').status).toEqual({
      label: 'STREAK 1,234D',
      on: true
    })
    expect(cursorDossier(cursorRow({ currentStreak: 0 }), '1').status).toEqual({
      label: 'NO STREAK',
      on: false
    })
  })

  it('prints dashes when the profile lists no models', () => {
    expect(cursorDossier(cursorRow({ topModels: [] }), '1').bars[0]).toEqual({
      k: 'MODEL',
      v: NO_SIGNAL
    })
  })

  it('sums agent runs for the bar and splits them in the codes', () => {
    const dossier = cursorDossier(cursorRow({ agentsLocal: 0, agentsCloud: 12_000 }), '1')
    expect(dossier.bars[1]).toEqual({ k: 'AGENTS', v: '12,000' })
    expect(dossier.codes).toEqual([
      { k: 'LOCAL', v: '0' },
      { k: 'CLOUD', v: '12,000' }
    ])
  })

  it('fills the FUEL bar as a share of the leader tokens, clamped and zero-guarded', () => {
    expect(cursorDossier(cursorRow({ tokens: '500' }), '1000').bar.frac).toBe(0.5)
    expect(cursorDossier(cursorRow({ tokens: '1000' }), '1000').bar.frac).toBe(1)
    expect(cursorDossier(cursorRow({ tokens: '1500' }), '1000').bar.frac).toBe(1)
    expect(cursorDossier(cursorRow({ tokens: '500' }), '0').bar.frac).toBe(0)
  })
})

describe('cursorProfileUrl', () => {
  it('links the claimed handle on cursor.com', () => {
    expect(cursorProfileUrl('pilot.dev')).toBe('https://cursor.com/@pilot.dev')
  })

  it('escapes anything that would break out of the path', () => {
    expect(cursorProfileUrl('a b/c?d')).toBe('https://cursor.com/@a%20b%2Fc%3Fd')
  })
})
