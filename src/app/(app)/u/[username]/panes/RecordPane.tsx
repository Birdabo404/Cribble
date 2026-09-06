// RECORD pane — the flight record on paper. Six stat cells in one
// anatomy (tracked pf-micro label, numeral on a shared baseline, context
// line always reserved so every cell is the same height), then the
// ACTIVITY grid (13 weeks of ink dots) and the SYSTEM LOG strip. RANK
// and SCORE keep the Press Start 2P numeral; the other four are Plex
// Mono tabular. Scores compact past 5 digits (142.5k → 143K) — the
// exact value lives in the title tooltip. Numerals render their FINAL
// value and carry data-pf-count / data-pf-format so the boot timeline
// can count them up from 0; reduced motion and no-JS simply see the
// finished number. A podium rank prints in its medal ink — no glow.
// SCORE and its +TODAY line are the pane's heat and print in
// --pf-ember-ink (5.04:1 on paper, 5.78:1 on the hover paper-3); the
// other cells stay charcoal. Ember is earned: a zero (a fresh pilot's
// SCORE, a quiet day's +0) is heat with no heat and prints in --pf-ink-3
// instead, the mute of RANK's unranked dash.

import { formatDuration, formatNumber, formatScore } from '@/components/dashboard-v2/format'
import { MoveGlyph } from '@/components/leaderboard/icons'
import type { PublicProfileData } from '@/types/profile'
import { ActivityGrid } from '../ActivityGrid'
import { medalInk, MONO_NUMERAL, monthYear, PIXEL_NUMERAL, StatCell } from '../parts'
import { SystemLog } from '../SystemLog'
import { buildSystemLog } from '../systemLogEntries'

/** SCORE's ink: ember for points on the board, ink-3 for none. */
const heatInk = (points: number) => (points > 0 ? 'var(--pf-ember-ink)' : 'var(--pf-ink-3)')

export function RecordPane({ profile }: { profile: PublicProfileData }) {
  const medal = medalInk(profile.rank)
  const rankUp = profile.rankDelta > 0

  return (
    <div className="px-[var(--pf-gutter)] py-5">
      {/* cells own their top+left hairlines; -1px hides the outer edge */}
      <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3">
        <StatCell
          label="RANK"
          sub={
            profile.rank !== null && profile.rankDelta !== 0 ? (
              <span
                className="flex items-center gap-1"
                style={{ color: rankUp ? 'var(--pf-ink-2)' : 'var(--pf-alert)' }}
              >
                <MoveGlyph dir={rankUp ? 'up' : 'down'} size={7} />
                {Math.abs(profile.rankDelta)} {Math.abs(profile.rankDelta) === 1 ? 'PLACE' : 'PLACES'}
              </span>
            ) : null
          }
        >
          {profile.rank !== null ? (
            <span
              className={PIXEL_NUMERAL}
              data-pf-count={profile.rank}
              data-pf-format="int"
              data-pf-prefix="#"
              style={{ color: medal ?? 'var(--pf-ink)' }}
            >
              #{profile.rank}
            </span>
          ) : (
            <span className={PIXEL_NUMERAL} style={{ color: 'var(--pf-ink-3)' }}>
              —
            </span>
          )}
        </StatCell>

        <StatCell
          label="SCORE"
          sub={<span style={{ color: heatInk(profile.todayScore) }}>+{formatScore(profile.todayScore)} TODAY</span>}
          title={`${formatNumber(profile.score)} lifetime points`}
        >
          <span
            className={PIXEL_NUMERAL}
            data-pf-count={profile.score}
            data-pf-format="score"
            style={{ color: heatInk(profile.score) }}
          >
            {formatScore(profile.score)}
          </span>
        </StatCell>

        <StatCell label="ACTIVE DAYS" sub={`SINCE ${monthYear(profile.memberSince)}`}>
          <span className={MONO_NUMERAL} data-pf-count={profile.activeDays} data-pf-format="int">
            {formatScore(profile.activeDays)}
          </span>
        </StatCell>

        <StatCell label="BEST STREAK" sub="DAYS IN A ROW">
          <span className={MONO_NUMERAL} data-pf-count={profile.longestStreak} data-pf-format="int">
            {formatScore(profile.longestStreak)}
          </span>
        </StatCell>

        <StatCell
          label="FOCUS TIME"
          sub={
            profile.activeDays > 0
              ? `${formatDuration(profile.totalActiveMs / profile.activeDays)} / DAY`
              : null
          }
        >
          <span className={MONO_NUMERAL} data-pf-count={profile.totalActiveMs} data-pf-format="duration">
            {formatDuration(profile.totalActiveMs)}
          </span>
        </StatCell>

        <StatCell
          label="THIS WEEK"
          sub="PTS THIS WEEK"
          title={`${formatNumber(profile.weekScore)} points this week`}
        >
          <span className={MONO_NUMERAL} data-pf-count={profile.weekScore} data-pf-format="score">
            {formatScore(profile.weekScore)}
          </span>
        </StatCell>
      </div>

      <ActivityGrid
        className="mt-6"
        days={profile.activity?.days ?? []}
        restricted={profile.restricted}
        hint={`Follow @${profile.username} to see their activity.`}
      />

      <SystemLog className="mt-6" entries={buildSystemLog(profile, new Date())} />
    </div>
  )
}
