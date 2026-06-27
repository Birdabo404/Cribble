import { formatCompact, formatNumber, tierAccent, HACKER_GREEN } from './format'
import type { GlobalTotals, LeaderUser, RankInfo } from '@/types/dashboard'

function GlobalTelemetryStrip({
  totals,
  myRank
}: {
  totals: GlobalTotals
  myRank: RankInfo | null
}) {
  const cells: { label: string; value: string; sub: string; accent?: boolean }[] = [
    {
      label: 'PLAYERS',
      value: formatNumber(totals.totalPlayers),
      sub: `${formatNumber(totals.activePlayers)} online now`
    },
    {
      label: 'POOLED',
      value: formatCompact(totals.totalPoints),
      sub: 'points this season'
    },
    {
      label: 'YOUR RANK',
      value: myRank ? `#${myRank.position}` : '—',
      sub: myRank ? `of ${formatNumber(myRank.total)} ranked` : 'unranked',
      accent: !!myRank
    }
  ]

  return (
    <div className="mt-4 grid grid-cols-3 rounded-lg border border-zinc-900/80 bg-black/40 overflow-hidden">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`relative px-3 py-2.5 ${i > 0 ? 'border-l border-zinc-900/80' : ''}`}
        >
          <div
            className="text-[9px] tracking-[0.35em]"
            style={{ color: c.accent ? `${HACKER_GREEN}cc` : '#71717a' }}
          >
            {c.label}
          </div>
          <div className="mt-1 text-base md:text-lg font-semibold tracking-tight text-zinc-50 tabular-nums">
            {c.value}
          </div>
          <div className="mt-0.5 text-[10px] tracking-wide text-zinc-500 truncate">
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  )
}

export function LeaderboardCard({
  rows,
  currentUserId,
  totals,
  myRank
}: {
  rows: LeaderUser[]
  currentUserId: number
  totals: GlobalTotals
  myRank: RankInfo | null
}) {
  return (
    <section className="col-span-12 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.4em] text-zinc-300">LEADERBOARD</div>
          <div className="text-xs text-zinc-400 mt-1">Top players · your neighborhood</div>
        </div>
        <a
          href="/leaderboard"
          className="text-[10px] tracking-[0.3em] text-zinc-400 hover:text-[#02fe01] transition-colors"
        >
          VIEW ALL →
        </a>
      </div>

      <GlobalTelemetryStrip totals={totals} myRank={myRank} />

      {rows.length === 0 ? (
        <div className="mt-6 text-xs text-zinc-500">Leaderboard loading…</div>
      ) : (
        <div className="mt-4 divide-y divide-zinc-900">
          {rows.map((u) => {
            const isYou = u.userId === currentUserId
            return (
              <div
                key={u.userId}
                className={`flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-md transition-colors ${
                  isYou
                    ? 'bg-[#02fe01]/[0.06] ring-1 ring-[#02fe01]/30'
                    : 'hover:bg-zinc-900/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-7 text-xs tabular-nums ${
                      isYou ? 'text-[#02fe01]' : 'text-zinc-500'
                    }`}
                  >
                    #{u.rank}
                  </span>
                  {u.profile_image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.profile_image}
                      alt={u.username}
                      className="h-6 w-6 rounded-full border border-zinc-800 object-cover"
                    />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-zinc-900 border border-zinc-800" />
                  )}
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-sm truncate ${
                        isYou ? 'text-[#02fe01]' : 'text-zinc-100'
                      }`}
                    >
                      @{u.username}
                    </span>
                    <span
                      className={`text-[9px] tracking-[0.3em] px-1.5 py-0.5 rounded border ${tierAccent(u.tier)}`}
                    >
                      {u.tier}
                    </span>
                    {u.isActive && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[#02fe01] shadow-[0_0_6px_rgba(2,254,1,0.7)]"
                        title="Active in last 24h"
                      />
                    )}
                  </div>
                </div>
                <div
                  className={`text-sm tabular-nums ${
                    isYou ? 'text-[#02fe01]' : 'text-zinc-100'
                  }`}
                >
                  {formatNumber(u.score)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
