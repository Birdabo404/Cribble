'use client'

// The faction podium — three machine thrones over the AI standings.
// Layout borrows the season Podium (champion center-tall on desktop,
// spotlight + compact pair on phones) but the language is houses, not
// pilots: square crests, brand washes, epithets, no avatars or plates.
// Every throne is a button that opens the ToolCard.

import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber, formatScore } from '@/components/dashboard-v2/format'
import type { AiToolRow } from '@/lib/aiLeaderboard'
import { identityForTool, toolInkRgb } from '@/lib/aiToolIdentity'
import { IconCrown, ToolIcon } from './icons'
import { medalA, medalFor } from './types'

/** Theme split: --tb (text/borders/fills) flips to ink on white; washes
 *  keep the raw hue via --tb-d so light mode gets pastels, not mud. */
const hueVars = (rgb: string) => ({
  ['--tb-d' as string]: rgb,
  ['--tb-i' as string]: toolInkRgb(rgb)
})

function ThroneCard({
  tool,
  leadOver,
  gapUp,
  isYourTeam,
  onSelect
}: {
  tool: AiToolRow
  /** champion only: points ahead of #2 */
  leadOver: number | null
  /** #2/#3: points needed to catch the rank above */
  gapUp: number | null
  isYourTeam: boolean
  onSelect: (tool: AiToolRow) => void
}) {
  const medal = medalFor(tool.rank)!
  const champion = tool.rank === 1
  const identity = identityForTool(tool.name)

  return (
    <button
      type="button"
      onClick={() => onSelect(tool)}
      aria-label={`Open faction card — ${tool.name}, rank ${tool.rank}`}
      className="aipod-card aipod-hue group relative w-full overflow-hidden rounded-2xl text-left"
      style={{
        ...hueVars(identity.rgb),
        background: `linear-gradient(180deg, rgb(255 255 255 / ${champion ? 0.05 : 0.035}), transparent 34%), rgb(var(--lb-panel-bg))`,
        border: `1px solid ${medalA(medal.rgb, champion ? 0.55 : 0.32)}`,
        boxShadow: champion
          ? `0 0 0 1px rgb(var(--tb) / 0.14), 0 24px 70px -28px ${medalA(medal.rgb, 0.45)}, 0 18px 50px -24px rgb(0 0 0 / 0.9)`
          : `0 18px 48px -26px rgb(0 0 0 / 0.85), 0 0 34px -18px ${medalA(medal.rgb, 0.4)}`
      }}
    >
      {/* keyline — brand blended into medal for the champion */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: champion
            ? `linear-gradient(90deg, transparent 4%, rgb(var(--tb)) 30%, ${medal.fg} 50%, rgb(var(--tb)) 70%, transparent 96%)`
            : `linear-gradient(90deg, transparent 4%, ${medal.fg} 50%, transparent 96%)`,
          opacity: champion ? 1 : 0.55,
          boxShadow: champion ? `0 0 12px ${medalA(medal.rgb, 0.8)}` : undefined
        }}
      />

      {/* silver/bronze sheen sweep on hover */}
      {!champion && (
        <span
          aria-hidden
          className="aipod-sheen pointer-events-none absolute inset-0 z-10"
          style={{
            background: `linear-gradient(115deg, transparent 30%, ${medalA(medal.rgb, 0.1)} 50%, transparent 70%)`
          }}
        />
      )}

      {/* banner — pure brand wash, no photos: houses have atmosphere */}
      <div className={`relative overflow-hidden ${champion ? 'h-[96px]' : 'h-[72px]'}`}>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: [
              `radial-gradient(130% 150% at 18% -20%, rgb(var(--tb-d) / ${champion ? 0.3 : 0.2}), transparent 55%)`,
              `radial-gradient(100% 140% at 100% 0%, ${medalA(medal.rgb, 0.12)}, transparent 55%)`,
              'repeating-linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.045) 0 1px, transparent 1px 20px)',
              'repeating-linear-gradient(0deg, rgb(var(--lb-panel-edge) / 0.045) 0 1px, transparent 1px 20px)'
            ].join(', ')
          }}
        />
        {champion && (
          <span
            aria-hidden
            className="aipod-beam absolute inset-y-0 w-24 opacity-70"
            style={{
              background: `linear-gradient(105deg, transparent, rgb(var(--tb-d) / 0.26) 50%, transparent)`
            }}
          />
        )}

        {/* place plate — bright literals on the dark scrim, both themes */}
        <span className="absolute left-3 top-3">
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
        </span>

        {isYourTeam && (
          <span
            className="absolute right-3 top-3 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.2em]"
            style={{
              color: `rgb(${medal.plate})`,
              background: 'rgb(0 0 0 / 0.55)',
              borderColor: `rgb(${medal.plate} / 0.45)`
            }}
          >
            YOUR TEAM
          </span>
        )}
      </div>

      {/* body */}
      <div className={`relative flex flex-col items-center px-5 text-center ${champion ? 'pb-5' : 'pb-4'}`}>
        {/* crest + ring */}
        <div className={`relative ${champion ? '-mt-[36px]' : '-mt-[26px]'}`}>
          {champion && (
            <span
              aria-hidden
              className="aipod-crown absolute -top-[26px] left-1/2 z-10 -translate-x-1/2 text-[rgb(var(--lb-gold))]"
            >
              <IconCrown size={22} />
            </span>
          )}
          <div className={`relative ${champion ? 'h-[76px] w-[76px]' : 'h-[60px] w-[60px]'}`}>
            {champion ? (
              <span
                aria-hidden
                className="aipod-halo absolute -inset-[3px] rounded-2xl"
                style={{
                  background: `conic-gradient(from 0deg, transparent, rgb(var(--tb) / 0.95) 90deg, rgb(var(--lb-gold-hi)) 130deg, transparent 210deg, ${medalA(medal.rgb, 0.5)} 305deg, transparent)`,
                  filter: `drop-shadow(0 0 9px ${medalA(medal.rgb, 0.6)})`
                }}
              />
            ) : (
              <span
                aria-hidden
                className="absolute -inset-[3px] rounded-2xl"
                style={{
                  background: `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, rgb(var(--tb) / 0.3), ${medalA(medal.rgb, 0.85)})`,
                  boxShadow: `0 0 16px ${medalA(medal.rgb, 0.3)}`
                }}
              />
            )}
            <span
              aria-hidden
              className="absolute inset-0 rounded-2xl"
              style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
            />
            <span
              className="absolute inset-[3px] flex items-center justify-center rounded-xl"
              style={{
                color: 'rgb(var(--tb))',
                background: `linear-gradient(180deg, rgb(var(--tb-d) / 0.12), rgb(var(--tb-d) / 0.05)), rgb(var(--lb-panel-bg))`,
                border: '1px solid rgb(var(--tb) / 0.4)'
              }}
            >
              <ToolIcon name={tool.name} size={champion ? 32 : 24} />
            </span>
          </div>
        </div>

        {/* identity */}
        <span
          className={`mt-2.5 max-w-full truncate font-display font-semibold tracking-tight text-zinc-50 ${
            champion ? 'text-lg' : 'text-[15px]'
          }`}
        >
          {tool.name}
        </span>
        <span
          className="mt-1 text-[8px] font-semibold tracking-[0.35em]"
          style={{ color: 'rgb(var(--tb))' }}
        >
          {identity.epithet}
        </span>

        {/* THE SCORE */}
        <div
          title={`${formatNumber(tool.score)} pts`}
          className={`mt-3 leading-none tabular-nums [font-family:var(--font-pixel)] ${
            champion ? 'text-[26px] md:text-[29px]' : 'text-[17px] md:text-[19px]'
          }`}
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: champion
              ? '0 0 20px rgb(var(--lb-score) / calc(0.65 * var(--lb-glow, 1))), 0 0 52px rgb(var(--lb-score) / calc(0.3 * var(--lb-glow, 1)))'
              : '0 0 16px rgb(var(--lb-score) / calc(0.45 * var(--lb-glow, 1)))'
          }}
        >
          <AnimatedCounter
            value={tool.score}
            duration={1300}
            formatter={(v) => formatScore(Math.round(v))}
          />
        </div>
        <span className="mt-1.5 text-[8px] tracking-[0.4em] text-zinc-600">PTS</span>

        {/* competitive read-out + the field facts */}
        <div className="mt-2.5 flex items-center gap-2 text-[10px] tabular-nums">
          {champion && leadOver !== null && leadOver > 0 && (
            <span style={{ color: 'rgb(var(--tb))' }}>LEAD +{formatNumber(leadOver)}</span>
          )}
          {!champion && gapUp !== null && (
            <span className="text-zinc-500">
              <span className="text-zinc-300">{formatNumber(gapUp)}</span> TO #{tool.rank - 1}
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[9px] tracking-[0.18em] text-zinc-600 tabular-nums">
          {formatNumber(tool.pilots)} PLAYERS · {tool.percent}% OF FIELD
        </div>
      </div>
    </button>
  )
}

// Phones-only compact throne for #2/#3 — the medal language with no
// banner strip so the pair fits side-by-side under the champion.
function CompactThrone({
  tool,
  onSelect
}: {
  tool: AiToolRow
  onSelect: (tool: AiToolRow) => void
}) {
  const medal = medalFor(tool.rank)!
  const identity = identityForTool(tool.name)

  return (
    <button
      type="button"
      onClick={() => onSelect(tool)}
      aria-label={`Open faction card — ${tool.name}, rank ${tool.rank}`}
      className="aipod-card aipod-hue group relative flex h-full w-full flex-col items-center overflow-hidden rounded-2xl px-3 pb-3.5 pt-4 text-center"
      style={{
        ...hueVars(identity.rgb),
        background: `linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent 34%), rgb(var(--lb-panel-bg))`,
        border: `1px solid ${medalA(medal.rgb, 0.32)}`,
        boxShadow: `0 18px 48px -26px rgb(0 0 0 / 0.85), 0 0 34px -18px ${medalA(medal.rgb, 0.4)}`
      }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 4%, ${medal.fg} 50%, transparent 96%)`,
          opacity: 0.55
        }}
      />

      <span className="relative block h-11 w-11">
        <span
          aria-hidden
          className="absolute -inset-[3px] rounded-xl"
          style={{
            background: `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.85)}, rgb(var(--tb) / 0.3), ${medalA(medal.rgb, 0.85)})`,
            boxShadow: `0 0 16px ${medalA(medal.rgb, 0.3)}`
          }}
        />
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl"
          style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
        />
        <span
          className="absolute inset-[3px] flex items-center justify-center rounded-lg"
          style={{
            color: 'rgb(var(--tb))',
            background: `linear-gradient(180deg, rgb(var(--tb-d) / 0.12), rgb(var(--tb-d) / 0.05)), rgb(var(--lb-panel-bg))`,
            border: '1px solid rgb(var(--tb) / 0.4)'
          }}
        >
          <ToolIcon name={tool.name} size={18} />
        </span>
      </span>

      <span
        className="mt-3 rounded-md px-2 py-1 text-[10px] leading-none tracking-[0.28em]"
        style={{
          color: `rgb(${medal.plate})`,
          background: 'rgb(0 0 0 / 0.55)',
          border: `1px solid rgb(${medal.plate} / 0.45)`,
          textShadow: `0 0 10px rgb(${medal.plate} / 0.6)`
        }}
      >
        {medal.label}
      </span>

      <span className="mt-2 max-w-full truncate font-display text-[13px] font-semibold tracking-tight text-zinc-50">
        {tool.name}
      </span>
      <span
        className="mt-0.5 max-w-full truncate text-[7px] font-semibold tracking-[0.3em]"
        style={{ color: 'rgb(var(--tb))' }}
      >
        {identity.epithet}
      </span>

      <span
        title={`${formatNumber(tool.score)} pts`}
        className="mt-2 block text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
        style={{
          color: 'rgb(var(--lb-score))',
          textShadow: '0 0 16px rgb(var(--lb-score) / calc(0.45 * var(--lb-glow, 1)))'
        }}
      >
        <AnimatedCounter
          value={tool.score}
          duration={1300}
          formatter={(v) => formatScore(Math.round(v))}
        />
      </span>
      <span className="mt-1 block text-[8px] tracking-[0.18em] text-zinc-600 tabular-nums">
        {tool.percent}% OF FIELD
      </span>
    </button>
  )
}

export function AiPodium({
  top3,
  viewerTopTool,
  onSelect
}: {
  top3: AiToolRow[]
  viewerTopTool: string | null
  onSelect: (tool: AiToolRow) => void
}) {
  const byRank = new Map(top3.map((t) => [t.rank, t]))
  const first = byRank.get(1)
  const second = byRank.get(2)
  const third = byRank.get(3)

  const column = (tool: AiToolRow | undefined, order: string, delay: number) => {
    if (!tool) return <div className={`hidden md:block ${order}`} />
    const champion = tool.rank === 1
    return (
      <div
        className={`aipod-col relative flex flex-col justify-end ${order}`}
        style={{ ['--pod-delay' as string]: `${delay}ms` }}
      >
        {champion && <span aria-hidden className="aipod-aura absolute -inset-x-10 -top-14 bottom-0" />}
        <ThroneCard
          tool={tool}
          leadOver={champion && second ? tool.score - second.score : null}
          gapUp={!champion ? (byRank.get(tool.rank - 1)?.score ?? 0) - tool.score : null}
          isYourTeam={tool.name === viewerTopTool}
          onSelect={onSelect}
        />
      </div>
    )
  }

  return (
    <section aria-label="Faction podium — top three machines" className="mb-5">
      {/* phones — champion spotlight, then the compact pair */}
      <div className="md:hidden">
        {first && (
          <div className="aipod-col relative" style={{ ['--pod-delay' as string]: '120ms' }}>
            <span aria-hidden className="aipod-aura absolute -inset-x-10 -top-14 bottom-0" />
            <ThroneCard
              tool={first}
              leadOver={second ? first.score - second.score : null}
              gapUp={null}
              isYourTeam={first.name === viewerTopTool}
              onSelect={onSelect}
            />
          </div>
        )}
        {(second || third) && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {second && (
              <div className="aipod-col relative" style={{ ['--pod-delay' as string]: '240ms' }}>
                <CompactThrone tool={second} onSelect={onSelect} />
              </div>
            )}
            {third && (
              <div className="aipod-col relative" style={{ ['--pod-delay' as string]: '340ms' }}>
                <CompactThrone tool={third} onSelect={onSelect} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* md+ — champion center-tall, 2-1-3 */}
      <div className="hidden items-end gap-4 md:grid md:grid-cols-3 md:gap-5">
        {column(first, 'md:order-2', 380)}
        {column(second, 'order-2 md:order-1', 120)}
        {column(third, 'order-3 md:order-3', 240)}
      </div>

      <style jsx global>{`
        .aipod-hue {
          --tb: var(--tb-d);
        }
        html.light .aipod-hue {
          --tb: var(--tb-i);
        }

        .aipod-col {
          animation: aipod-rise 720ms cubic-bezier(0.26, 1.25, 0.42, 1) backwards;
          animation-delay: var(--pod-delay, 0ms);
        }
        @keyframes aipod-rise {
          from {
            opacity: 0;
            transform: translateY(34px) scale(0.965);
          }
        }

        .aipod-card {
          transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms ease;
          cursor: pointer;
        }
        @media (hover: hover) and (pointer: fine) {
          .aipod-card:hover {
            transform: translateY(-4px) scale(1.012);
          }
        }
        .aipod-card:focus-visible {
          outline: 2px solid rgb(var(--tb) / 0.7);
          outline-offset: 2px;
        }

        /* champion aura — breathing brand-and-gold field behind the throne */
        .aipod-aura {
          background: radial-gradient(
            58% 52% at 50% 38%,
            rgb(var(--lb-gold) / 0.12),
            rgb(var(--lb-gold) / 0.04) 55%,
            transparent 75%
          );
          animation: aipod-aura-breathe 5.2s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes aipod-aura-breathe {
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

        .aipod-crown {
          animation: aipod-crown-bob 2.8s ease-in-out infinite;
          filter: drop-shadow(0 0 9px rgb(var(--lb-gold) / 0.75));
        }
        @keyframes aipod-crown-bob {
          0%,
          100% {
            transform: translate(-50%, 0) rotate(-2deg);
          }
          50% {
            transform: translate(-50%, -4px) rotate(2deg);
          }
        }

        .aipod-halo {
          animation: aipod-halo-spin 3.4s linear infinite;
        }
        @keyframes aipod-halo-spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* brand beam sweeping the champion banner */
        .aipod-beam {
          animation: aipod-beam-sweep 4.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes aipod-beam-sweep {
          0% {
            transform: translateX(-140%) skewX(-12deg);
          }
          55%,
          100% {
            transform: translateX(460%) skewX(-12deg);
          }
        }

        /* silver / bronze sheen — glides across on hover */
        .aipod-sheen {
          transform: translateX(-130%);
          transition: transform 900ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .aipod-card:hover .aipod-sheen {
            transform: translateX(130%);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .aipod-col,
          .aipod-aura,
          .aipod-crown,
          .aipod-halo,
          .aipod-beam {
            animation: none;
          }
          .aipod-card,
          .aipod-sheen {
            transition: none;
          }
        }
      `}</style>
    </section>
  )
}
