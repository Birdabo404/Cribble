// Feed → dossier mappers for the CRT monitor.
//
// One pure function per board source. Each takes a row in that board's
// own wire shape plus the leader's figure (for the bracketed bar), and
// returns the CrtDossier the tube renders. Nothing here touches React or
// the DOM, so the exact strings the monitor types out are unit-testable.
//
// Readout keys (`24H`, `AGENT`, …) are bare — the monitor appends the
// colon. Empty values print the two-em-dash `——` the GLOBAL feed has
// always used, so a missing tool, agent or model reads as "no signal"
// rather than a blank cell.

import { formatCompact, formatNumber } from '@/components/dashboard-v2/format'
import { pad, shareOf, type CrtDossier } from '@/components/leaderboard/crtDossier'
import { tokenPersonaVisual } from '@/components/leaderboard/tokenPersonaVisual'
import type { LeaderRow } from '@/components/leaderboard/types'
import type { CursorBoardRow } from '@/lib/cursorProfileBoard'
import {
  decimalToApproxNumber,
  exactIntegerToSafeNumber,
  formatApproxUsd,
  formatCompactTokenCount,
  tokenAgentLabel,
  type TokenBoardRow
} from '@/lib/tokenLeaderboard'

const NO_SIGNAL = '——'

/** Signed compact delta for the dossier bars: `+1.2k`, or `——` at zero. */
export function delta(n: number): string {
  return n > 0 ? `+${formatCompact(n)}` : NO_SIGNAL
}

/** Dossier serial: the user id in base-36, the way an ID card prints a
 *  personnel number (`PLT.0K3F`). Stable per pilot, never collides. */
export function serial(userId: number): string {
  return `PLT.${userId.toString(36).toUpperCase().padStart(4, '0')}`
}

/** The cursor.com profile a CURSOR-source dossier's PRESS START opens. */
export function cursorProfileUrl(cursorUsername: string): string {
  return `https://cursor.com/@${encodeURIComponent(cursorUsername)}`
}

/** Exact-integer token strings past 2^53 fall back to an approximation —
 *  the figure only drives a tween, so a few trailing digits are noise. */
function tokenCountToNumber(value: string): number {
  return exactIntegerToSafeNumber(value) ?? decimalToApproxNumber(value)
}

/** Count-up frames arrive fractional; the token formatter wants a
 *  canonical integer string. Units uppercase for the CRT (`1.2K`, `1.2M`). */
function formatTokenFigure(n: number): string {
  return formatCompactTokenCount(String(Math.max(0, Math.round(n)))).toUpperCase()
}

/** Whole-number figures the same way: round the frame, then group. */
function formatScoreFigure(n: number): string {
  return formatNumber(Math.round(n))
}

/** The EST.BURN figure counts in cents. The tube snaps the tween to whole
 *  units and rounds each frame before formatting, so a dollar-valued
 *  target would land on `$1,235.00`-style rounding; cents keep the frames
 *  honest and the final frame exact. Units uppercase for the CRT (`$250K`).
 *  A sub-cent burn rounds to zero cents but is still a burn — that one
 *  pins the tiny mark for the whole count. */
function burnFigure(usd: number): CrtDossier['figure'] {
  const cents = Math.round(usd * 100)
  return {
    label: 'EST.BURN',
    value: cents,
    format:
      cents === 0 && usd > 0
        ? () => '<$0.01'
        : (c) => formatApproxUsd(c / 100).toUpperCase()
  }
}

/** GLOBAL standings → the original attract-mode dossier, unchanged. */
export function pilotDossier(row: LeaderRow, topScore: number): CrtDossier {
  const tool = row.topTools?.[0]
  return {
    key: row.userId,
    rank: row.rank,
    name: row.display_name || `@${row.username}`,
    handle: row.username,
    avatar: { url: row.profile_image, handle: row.username },
    roster: 'PILOT',
    status: { label: row.isActive ? 'ONLINE' : 'OFFLINE', on: row.isActive },
    bars: [
      { k: '24H', v: delta(row.todayScore) },
      { k: 'TOOL', v: tool ? `${tool.name.toUpperCase()} ${tool.percent}%` : NO_SIGNAL }
    ],
    codes: [
      { k: '7D', v: delta(row.weekScore) },
      { k: 'ID', v: serial(row.userId) }
    ],
    figure: { label: 'SCORE', value: row.score, format: formatScoreFigure },
    bar: { label: 'PWR', frac: shareOf(row.score, topScore) },
    seed: row.userId,
    hint: 'PRESS START ─ OPEN PILOT CARD',
    aria: `Open pilot card — @${row.username}, rank ${row.rank}`
  }
}

/** THE BURN, CLI source → a burner dossier ranked by estimated spend. The
 *  status lamp is the persona label, lit only for the spend tiers (the
 *  ones that wear the flame on the board). */
export function cliDossier(row: TokenBoardRow, leaderBurnUsd: string): CrtDossier {
  const burn = decimalToApproxNumber(row.burnUsd)
  const agent =
    (tokenAgentLabel(row.topAgent) ?? (row.agents.length > 1 ? 'Mixed' : null))?.toUpperCase() ??
    NO_SIGNAL
  return {
    key: row.userId,
    rank: row.rank,
    name: row.displayName,
    handle: row.username,
    avatar: { url: row.profileImage, handle: row.username },
    roster: 'BURNER',
    status: { label: row.persona.label.toUpperCase(), on: tokenPersonaVisual(row.persona).flame },
    bars: [
      { k: 'AGENT', v: agent },
      { k: 'TOKENS', v: formatCompactTokenCount(row.totalTokens).toUpperCase() }
    ],
    codes: [
      { k: 'CACHE', v: `${Math.round(row.cachePercent)}%` },
      { k: 'DAYS', v: pad(row.activeDays) }
    ],
    figure: burnFigure(burn),
    bar: { label: 'FUEL', frac: shareOf(burn, decimalToApproxNumber(leaderBurnUsd)) },
    seed: row.userId,
    hint: 'PRESS START ─ OPEN BURN CARD',
    aria: `Open burn card — @${row.username}, rank ${row.rank}`
  }
}

/** THE BURN, CURSOR source → a burner dossier ranked by window tokens.
 *  The displayed identity is the claimed cursor.com handle and avatar,
 *  because that is what the row links to. The avatar's refresh handle is
 *  the Cribble account though: `avatarUrl` falls back to the Cribble
 *  profile image (often an X URL), and a dead X URL is refreshed by the X
 *  handle — the cursor.com handle would fetch a stranger's picture. */
export function cursorDossier(row: CursorBoardRow, leaderTokens: string): CrtDossier {
  const tokens = tokenCountToNumber(row.tokens)
  const streaking = row.currentStreak > 0
  return {
    key: row.userId,
    rank: row.rank,
    name: row.displayName,
    handle: row.cursorUsername,
    avatar: { url: row.avatarUrl, handle: row.username },
    roster: 'BURNER',
    status: {
      label: streaking ? `STREAK ${formatNumber(row.currentStreak)}D` : 'NO STREAK',
      on: streaking
    },
    bars: [
      { k: 'MODEL', v: row.topModels[0]?.toUpperCase() ?? NO_SIGNAL },
      { k: 'AGENTS', v: formatNumber(row.agentsLocal + row.agentsCloud) }
    ],
    codes: [
      { k: 'LOCAL', v: formatNumber(row.agentsLocal) },
      { k: 'CLOUD', v: formatNumber(row.agentsCloud) }
    ],
    figure: { label: 'TOKENS', value: tokens, format: formatTokenFigure },
    bar: { label: 'FUEL', frac: shareOf(tokens, tokenCountToNumber(leaderTokens)) },
    seed: row.userId,
    hint: 'PRESS START ─ OPEN CURSOR.COM PROFILE',
    aria: `Open cursor.com profile — @${row.cursorUsername}, rank ${row.rank}`
  }
}
