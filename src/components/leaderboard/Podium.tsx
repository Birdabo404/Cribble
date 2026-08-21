'use client'

// The podium — three medal thrones on real pedestal steps. The champion
// burns neon gold (spinning halo ring, bobbing crown, twinkling sparks,
// breathing aura); silver gets a cold platinum sheen sweep, bronze a warm
// ember pulse. Every card is a button that opens the player profile card.
// On phones the stack recomposes into a champion spotlight: #1 full-width,
// #2/#3 as compact medal thrones side-by-side beneath it.

import AnimatedCounter from '@/components/AnimatedCounter'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { formatNumber, formatScore } from '@/components/dashboard-v2/format'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { isProTier } from '@/lib/entitlements'
import { Avatar, SafeBannerImg } from './Avatar'
import { IconCrown, IconSpark, MoveGlyph, ToolIcon } from './icons'
import { medalA, medalFor, medalGlow, PLATE_DOWN, PLATE_UP, type LeaderRow } from './types'

function DefaultBanner({ rankRgb, champion }: { rankRgb: string; champion: boolean }) {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: [
            `radial-gradient(130% 150% at 18% -20%, ${medalA(rankRgb, champion ? 0.34 : 0.22)}, transparent 55%)`,
            `radial-gradient(100% 140% at 100% 0%, ${medalA(rankRgb, 0.12)}, transparent 55%)`,
            `repeating-linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.045) 0 1px, transparent 1px 20px)`,
            `repeating-linear-gradient(0deg, rgb(var(--lb-panel-edge) / 0.045) 0 1px, transparent 1px 20px)`
          ].join(', ')
        }}
      />
      {champion && (
        <span
          className="pod-beam absolute inset-y-0 w-24 opacity-70"
          style={{
            background: `linear-gradient(105deg, transparent, ${medalA(rankRgb, 0.28)} 50%, transparent)`
          }}
        />
      )}
    </div>
  )
}

function PodiumCard({
  user,
  leadOver,
  gapUp,
  isYou,
  onSelect
}: {
  user: LeaderRow
  /** champion only: points ahead of #2 */
  leadOver: number | null
  /** #2/#3: points needed to catch the rank above */
  gapUp: number | null
  isYou: boolean
  onSelect: (user: LeaderRow) => void
}) {
  const medal = medalFor(user.rank)!
  const champion = user.rank === 1
  const topTool = user.topTools?.[0]
  // Companies (tier TEAM) are square, pilots are round.
  const avatarRound = user.tier === 'TEAM' ? 'rounded-xl' : 'rounded-full'
  const avatarImgRound = user.tier === 'TEAM' ? 'rounded-lg' : 'rounded-full'

  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      aria-label={`Open profile — @${user.username}, rank ${user.rank}`}
      className={`pod-card group relative w-full overflow-hidden rounded-2xl text-left ${
        champion ? 'pod-card-gold' : ''
      }`}
      style={{
        background: `linear-gradient(180deg, rgb(255 255 255 / ${champion ? 0.05 : 0.035}), transparent 34%), rgb(var(--lb-panel-bg))`,
        border: `1px solid ${medalA(medal.rgb, champion ? 0.55 : 0.32)}`,
        boxShadow: champion
          ? `0 0 0 1px ${medalA(medal.rgb, 0.15)}, 0 24px 70px -28px ${medalA(medal.rgb, 0.45)}, 0 18px 50px -24px rgb(0 0 0 / 0.9)`
          : `0 18px 48px -26px rgb(0 0 0 / 0.85), 0 0 34px -18px ${medalA(medal.rgb, 0.4)}`
      }}
    >
      {/* medal keyline across the top */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, ${medal.fg} 50%, transparent 96%)`,
          opacity: champion ? 1 : 0.55,
          boxShadow: champion ? `0 0 12px ${medalA(medal.rgb, 0.8)}` : undefined
        }}
      />

      {/* silver/bronze sheen sweep on hover + slow idle for silver */}
      {!champion && (
        <span
          aria-hidden
          className="pod-sheen pointer-events-none absolute inset-0 z-10"
          style={{
            background: `linear-gradient(115deg, transparent 30%, ${medalA(medal.rgb, 0.1)} 50%, transparent 70%)`
          }}
        />
      )}

      {/* banner — default always paints; an equipped plate layers above it,
          and a live banner_image wins over both in this block (the plate
          still shows on the standings row) */}
      <div className={`relative overflow-hidden ${champion ? 'h-[112px]' : 'h-[88px]'}`}>
        <DefaultBanner rankRgb={medal.rgb} champion={champion} />
        {user.plate && (
          <>
            {/* plate art is authored against the dark arena panel — an
                opaque dark base (same guard as the standings rows) keeps
                it from blending into the light DefaultBanner underneath */}
            <span aria-hidden className="absolute inset-0" style={{ background: 'rgb(9 10 13)' }} />
            <PlateLayer plateId={user.plate} fade="none" />
            {/* melt-into-the-body scrim, confined to the bottom band: it
                only has to seat the overlapping avatar. Dark mode fades
                the art into the panel body (60% of the taller banner keeps
                the fade band at roughly the same absolute height it had at
                52% of the old one); in light mode the panel is white and
                that same fade washed the art toward white, so the seat
                becomes a short dark vignette instead, capped by an ink
                hairline where the art meets the card body — a framed
                artwork window, not a fade-out. Themed via .pod-melt. */}
            <span aria-hidden className="pod-melt absolute inset-0" />
            <span aria-hidden className="pod-melt-sill absolute inset-x-0 bottom-0 h-px" />
          </>
        )}
        {user.banner_image && (
          <>
            <SafeBannerImg
              src={user.banner_image}
              frame={user.banner_frame}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, transparent 60%, rgb(var(--lb-panel-bg) / 0.92))`
              }}
            />
          </>
        )}

        {/* place plate — bright literals: the pill scrim stays dark in both themes */}
        <span className="absolute left-3 top-3 flex items-center gap-2">
          <span
            className="rounded-md px-2 py-1 text-[10px] leading-none tracking-[0.28em]"
            style={{
              color: `rgb(${medal.plate})`,
              background: 'rgb(0 0 0 / 0.55)',
              border: `1px solid rgb(${medal.plate} / 0.45)`,
              textShadow: `0 0 10px rgb(${medal.plate} / 0.6)`
            }}
          >
            {medal.label}
          </span>
          {user.rankDelta !== 0 && (
            <span
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums"
              style={{
                color: user.rankDelta > 0 ? `rgb(${PLATE_UP})` : `rgb(${PLATE_DOWN})`,
                background: 'rgb(0 0 0 / 0.55)'
              }}
            >
              <MoveGlyph dir={user.rankDelta > 0 ? 'up' : 'down'} size={6} />
              {Math.abs(user.rankDelta)}
            </span>
          )}
        </span>

        {isYou && (
          <span className="absolute right-3 top-3 rounded border border-accent/50 bg-black/50 px-1.5 py-0.5 text-[8px] tracking-[0.25em] text-accent">
            YOU
          </span>
        )}
      </div>

      {/* body */}
      <div className={`relative flex flex-col items-center px-5 text-center ${champion ? 'pb-5' : 'pb-4'}`}>
        {/* avatar + halo */}
        <div className={`relative ${champion ? '-mt-[38px]' : '-mt-[28px]'}`}>
          {champion && (
            <span aria-hidden className="pod-crown absolute -top-[26px] left-1/2 z-10 -translate-x-1/2 text-[rgb(var(--lb-gold))]">
              <IconCrown size={22} />
            </span>
          )}
          <div className={`relative ${champion ? 'h-[84px] w-[84px]' : 'h-[64px] w-[64px]'}`}>
            {champion ? (
              <span
                aria-hidden
                className={`pod-halo absolute -inset-[3px] ${avatarRound}`}
                style={{
                  background: `conic-gradient(from 0deg, transparent, ${medalA(medal.rgb, 0.95)} 90deg, rgb(var(--lb-gold-hi)) 130deg, transparent 210deg, ${medalA(medal.rgb, 0.5)} 305deg, transparent)`,
                  filter: `drop-shadow(0 0 9px ${medalA(medal.rgb, 0.6)})`
                }}
              />
            ) : (
              <span
                aria-hidden
                className={`absolute -inset-[3px] ${avatarRound}`}
                style={{
                  background: `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, ${medalA(medal.rgb, 0.22)}, ${medalA(medal.rgb, 0.85)})`,
                  boxShadow: `0 0 16px ${medalA(medal.rgb, 0.3)}`
                }}
              />
            )}
            <span
              aria-hidden
              className={`absolute inset-0 ${avatarRound}`}
              style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
            />
            <Avatar
              src={user.profile_image}
              char={user.username[0]?.toUpperCase() ?? '?'}
              imgClassName={`absolute inset-[3px] ${avatarImgRound} object-cover`}
              imgStyle={{ width: 'calc(100% - 6px)', height: 'calc(100% - 6px)' }}
              fallbackClassName={`absolute inset-[3px] flex items-center justify-center ${avatarImgRound} bg-zinc-900 font-display text-zinc-300 ${
                champion ? 'text-2xl' : 'text-lg'
              }`}
            />
            {user.isActive && (
              <span
                className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full"
                style={{
                  background: 'rgb(var(--lb-up))',
                  boxShadow: '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2px rgb(var(--lb-panel-bg))'
                }}
              />
            )}
          </div>
        </div>

        {/* identity */}
        <div className="mt-2.5 flex max-w-full items-center justify-center gap-1.5">
          <span
            className={`truncate font-display font-semibold tracking-tight text-zinc-50 ${
              champion ? 'text-lg' : 'text-[15px]'
            }`}
          >
            {user.display_name || `@${user.username}`}
          </span>
          {isProTier(user.tier) && <VerifiedBadge size={champion ? 16 : 14} />}
          {user.team && <TeamMiniLogo team={user.team} size={champion ? 16 : 14} />}
        </div>
        <span className="mt-0.5 text-[10px] text-zinc-500">@{user.username}</span>

        {/* THE SCORE — compacts past 5 digits; exact value in the tooltip */}
        <div
          title={`${formatNumber(user.score)} pts`}
          className={`mt-3 leading-none tabular-nums [font-family:var(--font-pixel)] ${
            champion ? 'pod-score-gold text-[27px] md:text-[30px]' : 'text-[18px] md:text-[20px]'
          }`}
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: champion
              ? '0 0 20px rgb(var(--lb-score) / calc(0.65 * var(--lb-glow, 1))), 0 0 52px rgb(var(--lb-score) / calc(0.3 * var(--lb-glow, 1))), 0 0 90px rgb(var(--lb-score) / calc(0.16 * var(--lb-glow, 1)))'
              : '0 0 16px rgb(var(--lb-score) / calc(0.45 * var(--lb-glow, 1)))'
          }}
        >
          <AnimatedCounter
            value={user.score}
            duration={1300}
            formatter={(v) => formatScore(Math.round(v))}
          />
        </div>
        <span className="mt-1.5 text-[8px] tracking-[0.4em] text-zinc-600">PTS</span>

        {/* competitive read-out: lead / gap + today's grind */}
        <div className="mt-2.5 flex items-center gap-2 text-[10px] tabular-nums">
          {champion && leadOver !== null && leadOver > 0 && (
            <span style={{ color: medalA(medal.rgb, 0.9) }}>
              LEAD +{formatNumber(leadOver)}
            </span>
          )}
          {!champion && gapUp !== null && (
            <span className="text-zinc-500">
              <span className="text-zinc-300">{formatNumber(gapUp)}</span> TO #{user.rank - 1}
            </span>
          )}
          {user.todayScore > 0 && (
            <>
              <span className="text-zinc-700">·</span>
              <span style={{ color: 'rgb(var(--lb-delta))' }}>+{formatNumber(user.todayScore)} today</span>
            </>
          )}
        </div>

        {/* top weapon */}
        {topTool && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg px-2.5 py-1.5"
            style={{
              background: 'rgb(var(--lb-panel-edge) / 0.035)',
              border: '1px solid rgb(var(--lb-panel-edge) / 0.09)'
            }}
          >
            <ToolIcon name={topTool.name} size={13} className="text-zinc-300" />
            <span className="font-display text-[11px] font-medium text-zinc-200">{topTool.name}</span>
            <span className="text-[9px] tabular-nums text-zinc-500">{topTool.percent}%</span>
          </div>
        )}
      </div>
    </button>
  )
}

// Phones-only compact throne for #2/#3 — the full card's medal language
// (top keyline, conic avatar ring, place plate) with no banner strip,
// halo or sheen, so the pair fits side-by-side under the champion.
function CompactPodiumCard({
  user,
  onSelect
}: {
  user: LeaderRow
  onSelect: (user: LeaderRow) => void
}) {
  const medal = medalFor(user.rank)!
  const avatarRound = user.tier === 'TEAM' ? 'rounded-xl' : 'rounded-full'
  const avatarImgRound = user.tier === 'TEAM' ? 'rounded-lg' : 'rounded-full'

  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      aria-label={`Open profile — @${user.username}, rank ${user.rank}`}
      className="pod-card group relative flex h-full w-full flex-col items-center overflow-hidden rounded-2xl px-3 pb-3.5 pt-4 text-center"
      style={{
        background: `linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent 34%), rgb(var(--lb-panel-bg))`,
        border: `1px solid ${medalA(medal.rgb, 0.32)}`,
        boxShadow: `0 18px 48px -26px rgb(0 0 0 / 0.85), 0 0 34px -18px ${medalA(medal.rgb, 0.4)}`
      }}
    >
      {/* medal keyline across the top */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, ${medal.fg} 50%, transparent 96%)`,
          opacity: 0.55
        }}
      />

      {/* medal-ringed avatar — the static conic ring, no halo spin */}
      <span className="relative block h-12 w-12">
        <span
          aria-hidden
          className={`absolute -inset-[3px] ${avatarRound}`}
          style={{
            background: `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, ${medalA(medal.rgb, 0.22)}, ${medalA(medal.rgb, 0.85)})`,
            boxShadow: `0 0 16px ${medalA(medal.rgb, 0.3)}`
          }}
        />
        <span
          aria-hidden
          className={`absolute inset-0 ${avatarRound}`}
          style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
        />
        <Avatar
          src={user.profile_image}
          char={user.username[0]?.toUpperCase() ?? '?'}
          imgClassName={`absolute inset-[3px] ${avatarImgRound} object-cover`}
          imgStyle={{ width: 'calc(100% - 6px)', height: 'calc(100% - 6px)' }}
          fallbackClassName={`absolute inset-[3px] flex items-center justify-center ${avatarImgRound} bg-zinc-900 font-display text-sm text-zinc-300`}
        />
        {user.isActive && (
          <span
            className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full"
            style={{
              background: 'rgb(var(--lb-up))',
              boxShadow: '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2px rgb(var(--lb-panel-bg))'
            }}
          />
        )}
      </span>

      {/* place plate + movement chip */}
      <span className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <span
          className="rounded-md px-2 py-1 text-[10px] leading-none tracking-[0.28em]"
          style={{
            color: `rgb(${medal.plate})`,
            background: 'rgb(0 0 0 / 0.55)',
            border: `1px solid rgb(${medal.plate} / 0.45)`,
            textShadow: `0 0 10px rgb(${medal.plate} / 0.6)`
          }}
        >
          {medal.label}
        </span>
        {user.rankDelta !== 0 && (
          <span
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{
              color: user.rankDelta > 0 ? `rgb(${PLATE_UP})` : `rgb(${PLATE_DOWN})`,
              background: 'rgb(0 0 0 / 0.55)'
            }}
          >
            <MoveGlyph dir={user.rankDelta > 0 ? 'up' : 'down'} size={6} />
            {Math.abs(user.rankDelta)}
          </span>
        )}
      </span>

      {/* identity */}
      <span className="mt-2 flex max-w-full items-center justify-center gap-1">
        <span className="min-w-0 truncate font-display text-[13px] font-semibold tracking-tight text-zinc-50">
          {user.display_name || `@${user.username}`}
        </span>
        {isProTier(user.tier) && <VerifiedBadge size={12} />}
        {user.team && <TeamMiniLogo team={user.team} size={12} />}
      </span>

      {/* score + today's grind */}
      <span
        title={`${formatNumber(user.score)} pts`}
        className="mt-2 block text-[16px] leading-none tabular-nums [font-family:var(--font-pixel)]"
        style={{
          color: 'rgb(var(--lb-score))',
          textShadow: '0 0 16px rgb(var(--lb-score) / calc(0.45 * var(--lb-glow, 1)))'
        }}
      >
        <AnimatedCounter
          value={user.score}
          duration={1300}
          formatter={(v) => formatScore(Math.round(v))}
        />
      </span>
      {user.todayScore > 0 && (
        <span className="mt-1 block text-[9px] tabular-nums" style={{ color: 'rgb(var(--lb-delta))' }}>
          +{formatNumber(user.todayScore)} today
        </span>
      )}
    </button>
  )
}

/** The champion's ambient FX field — breathing aura plus four twinkling
 *  sparks. The last two sparks carry pod-spark-extra so phones can drop
 *  them (nth-of-type can't isolate them: pod-aura is a span sibling). */
function ChampionFx() {
  return (
    <>
      <span aria-hidden className="pod-aura absolute -inset-x-10 -top-16 bottom-0" />
      <span aria-hidden className="pod-spark absolute -top-3 left-[12%] text-[rgb(var(--lb-gold))]" style={{ animationDelay: '0s' }}>
        <IconSpark size={11} />
      </span>
      <span aria-hidden className="pod-spark absolute top-6 right-[8%] text-[rgb(var(--lb-gold-hi))]" style={{ animationDelay: '0.9s' }}>
        <IconSpark size={8} />
      </span>
      <span aria-hidden className="pod-spark pod-spark-extra absolute top-1/3 -left-1 text-[rgb(var(--lb-gold))]" style={{ animationDelay: '1.7s' }}>
        <IconSpark size={7} />
      </span>
      <span aria-hidden className="pod-spark pod-spark-extra absolute bottom-24 right-1 text-[rgb(var(--lb-gold-hi))]" style={{ animationDelay: '2.4s' }}>
        <IconSpark size={9} />
      </span>
    </>
  )
}

function Pedestal({ rank }: { rank: number }) {
  const medal = medalFor(rank)!
  const height = rank === 1 ? 'md:h-[88px]' : rank === 2 ? 'md:h-[54px]' : 'md:h-[34px]'
  return (
    <div
      aria-hidden
      className={`pod-step relative hidden md:flex ${height} mt-2 items-center justify-center overflow-hidden`}
      style={{
        background: `linear-gradient(180deg, rgb(var(--lb-panel-edge) / 0.07), rgb(var(--lb-panel-edge) / 0.015)), rgb(var(--lb-panel-bg))`,
        border: `1px solid rgb(var(--lb-panel-edge) / 0.09)`,
        borderTop: `1px solid ${medalA(medal.rgb, 0.45)}`,
        clipPath: 'polygon(3.5% 0, 96.5% 0, 100% 100%, 0 100%)'
      }}
    >
      <span
        className="select-none leading-none [font-family:var(--font-pixel)]"
        style={{
          fontSize: rank === 1 ? 40 : 22,
          color: medalA(medal.rgb, rank === 1 ? 0.5 : 0.35),
          textShadow: `0 0 18px ${medalGlow(medal.rgb, 0.35)}`
        }}
      >
        {rank}
      </span>
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(180deg, rgb(0 0 0 / 0.16) 0 1px, transparent 1px 3px)'
        }}
      />
    </div>
  )
}

export function Podium({
  top3,
  currentUserId,
  onSelect
}: {
  top3: LeaderRow[]
  currentUserId: number | null
  onSelect: (user: LeaderRow) => void
}) {
  const byRank = new Map(top3.map((u) => [u.rank, u]))
  const first = byRank.get(1)
  const second = byRank.get(2)
  const third = byRank.get(3)

  const column = (user: LeaderRow | undefined, order: string, delay: number) => {
    if (!user) return <div className={`hidden md:block ${order}`} />
    const champion = user.rank === 1
    return (
      <div
        className={`pod-col relative flex flex-col justify-end ${order}`}
        style={{ ['--pod-delay' as string]: `${delay}ms` }}
      >
        {champion && <ChampionFx />}
        <PodiumCard
          user={user}
          leadOver={champion && second ? user.score - second.score : null}
          gapUp={
            !champion
              ? (byRank.get(user.rank - 1)?.score ?? 0) - user.score
              : null
          }
          isYou={user.userId === currentUserId}
          onSelect={onSelect}
        />
        <Pedestal rank={user.rank} />
      </div>
    )
  }

  return (
    <section aria-label="Podium — top three players">
      {/* phones — champion spotlight: full-width #1, compact #2/#3 pair */}
      <div className="md:hidden">
        {first && (
          <div
            className="pod-col relative"
            style={{ ['--pod-delay' as string]: '120ms' }}
          >
            <ChampionFx />
            <PodiumCard
              user={first}
              leadOver={second ? first.score - second.score : null}
              gapUp={null}
              isYou={first.userId === currentUserId}
              onSelect={onSelect}
            />
          </div>
        )}
        {(second || third) && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {second && (
              <div className="pod-col relative" style={{ ['--pod-delay' as string]: '240ms' }}>
                <CompactPodiumCard user={second} onSelect={onSelect} />
              </div>
            )}
            {third && (
              <div className="pod-col relative" style={{ ['--pod-delay' as string]: '340ms' }}>
                <CompactPodiumCard user={third} onSelect={onSelect} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* md+ — three thrones on pedestal steps, unchanged */}
      <div className="hidden items-end gap-4 md:grid md:grid-cols-3 md:gap-5">
        {column(first, 'md:order-2', 380)}
        {column(second, 'order-2 md:order-1', 120)}
        {column(third, 'order-3 md:order-3', 240)}
      </div>

      <style jsx global>{`
        .pod-col {
          animation: pod-rise 720ms cubic-bezier(0.26, 1.25, 0.42, 1) backwards;
          animation-delay: var(--pod-delay, 0ms);
        }
        @keyframes pod-rise {
          from {
            opacity: 0;
            transform: translateY(34px) scale(0.965);
          }
        }

        .pod-card {
          transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms ease;
          cursor: pointer;
        }
        @media (hover: hover) and (pointer: fine) {
          .pod-card:hover {
            transform: translateY(-4px) scale(1.012);
          }
        }
        .pod-card:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }

        /* plate-banner seat — dark melts the art into the panel body;
           light frames it instead (dark vignette + ink hairline), because
           a white panel-bg melt washes the fixed dark art gray */
        .pod-melt {
          background: linear-gradient(180deg, transparent 60%, rgb(var(--lb-panel-bg) / 0.92));
        }
        .pod-melt-sill {
          display: none;
        }
        html.light .pod-melt {
          background: linear-gradient(180deg, transparent 58%, rgb(0 0 0 / 0.42));
        }
        html.light .pod-melt-sill {
          display: block;
          background: rgb(9 9 11 / 0.65);
        }

        /* champion aura — breathing gold field behind the center column */
        .pod-aura {
          background: radial-gradient(
            58% 52% at 50% 38%,
            rgb(var(--lb-gold) / 0.16),
            rgb(var(--lb-gold) / 0.05) 55%,
            transparent 75%
          );
          animation: pod-aura-breathe 5.2s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes pod-aura-breathe {
          0%,
          100% {
            opacity: 0.75;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.06);
          }
        }

        .pod-crown {
          animation: pod-crown-bob 2.8s ease-in-out infinite;
          filter: drop-shadow(0 0 9px rgb(var(--lb-gold) / 0.75));
        }
        @keyframes pod-crown-bob {
          0%,
          100% {
            transform: translate(-50%, 0) rotate(-2deg);
          }
          50% {
            transform: translate(-50%, -4px) rotate(2deg);
          }
        }

        .pod-halo {
          animation: pod-halo-spin 3.4s linear infinite;
        }
        @keyframes pod-halo-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* champion score glint — periodic brightness flare */
        .pod-score-gold {
          animation: pod-score-glint 5.5s ease-in-out infinite;
        }
        @keyframes pod-score-glint {
          0%,
          88%,
          100% {
            filter: brightness(1);
          }
          93% {
            filter: brightness(1.45);
          }
        }

        /* gold beam sweeping the champion's default banner */
        .pod-beam {
          animation: pod-beam-sweep 4.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pod-beam-sweep {
          0% {
            transform: translateX(-140%) skewX(-12deg);
          }
          55%,
          100% {
            transform: translateX(460%) skewX(-12deg);
          }
        }

        /* silver / bronze sheen — glides across on hover */
        .pod-sheen {
          transform: translateX(-130%);
          transition: transform 900ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .pod-card:hover .pod-sheen {
            transform: translateX(130%);
          }
        }

        .pod-spark {
          animation: pod-spark-twinkle 3.6s ease-in-out infinite;
          filter: drop-shadow(0 0 5px currentColor);
          pointer-events: none;
          z-index: 5;
        }
        @keyframes pod-spark-twinkle {
          0%,
          100% {
            opacity: 0;
            transform: scale(0.4) rotate(0deg);
          }
          18% {
            opacity: 1;
            transform: scale(1.05) rotate(20deg);
          }
          36% {
            opacity: 0.15;
            transform: scale(0.55) rotate(45deg);
          }
        }

        /* phones run 2 of the 4 champion sparks — fewer infinite
           drop-shadow animations on the mobile GPU */
        @media (max-width: 767px) {
          .pod-spark-extra {
            display: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pod-col,
          .pod-aura,
          .pod-crown,
          .pod-halo,
          .pod-score-gold,
          .pod-beam,
          .pod-spark {
            animation: none;
          }
          .pod-card,
          .pod-sheen {
            transition: none;
          }
        }
      `}</style>
    </section>
  )
}
