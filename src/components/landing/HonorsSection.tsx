'use client'

// Descent stage 04 — THE HONORS. The real 25-medal service record: 24 tiles
// igniting in a radial wave around one APEX centerpiece — the legendary that
// only ever exists on one account at a time. Hovering a tile reads out its
// name + brief on the inspection line below the wall.

import { CSSProperties, useState } from 'react'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { IconCrown } from '@/components/leaderboard/icons'
import type { AchievementDef } from '@/lib/achievements'
import { APEX, HONOR_TILES, RARITY_COLOR } from './data'
import { CountUp, Seam, SectionHeader, Stage } from './scrollFx'

/** The story the wall tells: a mid-ladder pilot's record. */
const UNLOCKED = new Set([
  'score_1k',
  'score_10k',
  'score_50k',
  'streak_3',
  'streak_7',
  'first_sync',
  'tools_3',
  'tools_5',
  'visits_100',
  'deep_1',
  'day_1k'
])

const COLS = 8

function tileDelay(index: number): number {
  // radial ignition wave measured from the wall's center tile
  const row = Math.floor(index / COLS)
  const col = index % COLS
  const dist = Math.hypot(col - (COLS - 1) / 2, row - 1)
  return 420 + Math.round(dist * 130)
}

function Tile({
  def,
  index,
  onHover
}: {
  def: AchievementDef
  index: number
  onHover: (def: AchievementDef) => void
}) {
  const unlocked = UNLOCKED.has(def.id)
  const color = RARITY_COLOR[def.rarity]

  return (
    <button
      type="button"
      onPointerEnter={() => onHover(def)}
      onFocus={() => onHover(def)}
      aria-label={`${def.name} — ${def.description}`}
      className="st-cell hn-tile group relative flex aspect-square items-center justify-center rounded-lg"
      style={
        {
          '--d': `${tileDelay(index)}ms`,
          '--hn-c': color,
          background: unlocked
            ? `linear-gradient(160deg, rgb(255 255 255 / 0.04), transparent 55%), rgb(var(--lb-panel-bg))`
            : 'rgb(var(--lb-panel-bg))',
          border: unlocked
            ? `1px solid color-mix(in srgb, ${color} 45%, transparent)`
            : '1px solid rgb(var(--lb-panel-edge) / 0.07)',
          boxShadow: unlocked
            ? `0 0 22px -10px ${color}`
            : undefined
        } as CSSProperties
      }
    >
      <span
        className="transition-transform duration-300 group-hover:scale-110"
        style={{
          color: unlocked ? color : 'rgb(var(--z600))',
          opacity: unlocked ? 1 : 0.7,
          filter: unlocked ? `drop-shadow(0 0 6px ${color})` : undefined
        }}
      >
        <PixelIcon name={def.icon} size={28} />
      </span>
      {!unlocked && (
        <span
          aria-hidden
          className="absolute bottom-1 right-1.5 text-[8px] text-zinc-700"
        >
          ▪
        </span>
      )}
      {def.rarity === 'legendary' && unlocked === false && (
        <span
          aria-hidden
          className="hn-legend-shimmer pointer-events-none absolute inset-0 rounded-lg"
        />
      )}
    </button>
  )
}

function ApexCenterpiece() {
  return (
    <div
      className="st hn-apex lx-hw relative overflow-hidden rounded-2xl"
      style={
        {
          '--d': '1300ms',
          background:
            'linear-gradient(180deg, rgb(255 214 68 / 0.06), transparent 45%), rgb(var(--lb-panel-bg))',
          border: '1px solid rgb(var(--lb-gold) / 0.45)',
          boxShadow:
            '0 0 0 1px rgb(var(--lb-gold) / 0.12), 0 28px 70px -30px rgb(var(--lb-gold) / 0.4), 0 18px 50px -24px rgb(0 0 0 / 0.9)'
        } as CSSProperties
      }
    >
      {/* rotating conic halo behind the crown */}
      <span
        aria-hidden
        className="hn-apex-halo absolute left-1/2 top-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40"
        style={{
          background:
            'conic-gradient(from 0deg, transparent, rgb(var(--lb-gold) / 0.28) 90deg, rgb(var(--lb-gold-hi) / 0.4) 130deg, transparent 210deg, rgb(var(--lb-gold) / 0.16) 305deg, transparent)',
          filter: 'blur(14px)'
        }}
      />
      <span
        aria-hidden
        className="hn-apex-beam absolute inset-y-0 w-28 opacity-60"
        style={{
          background:
            'linear-gradient(105deg, transparent, rgb(var(--lb-gold) / 0.22) 50%, transparent)'
        }}
      />

      <div className="relative flex flex-col items-center px-6 py-8 text-center sm:flex-row sm:gap-7 sm:px-8 sm:text-left">
        <div className="relative shrink-0">
          <span
            aria-hidden
            className="hn-crown-bob absolute -top-5 left-1/2 -translate-x-1/2 text-[rgb(var(--lb-gold))]"
          >
            <IconCrown size={18} />
          </span>
          <span
            className="flex h-20 w-20 items-center justify-center rounded-xl"
            style={{
              color: 'rgb(var(--lb-gold))',
              background: 'rgb(var(--lb-gold) / 0.07)',
              border: '1px solid rgb(var(--lb-gold) / 0.5)',
              boxShadow:
                'inset 0 0 24px rgb(var(--lb-gold) / 0.12), 0 0 34px -8px rgb(var(--lb-gold) / 0.5)',
              filter: 'drop-shadow(0 0 10px rgb(var(--lb-gold) / 0.6))'
            }}
          >
            <PixelIcon name={APEX.icon} size={40} />
          </span>
        </div>

        <div className="mt-5 min-w-0 sm:mt-0">
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
            <span
              className="font-display text-2xl font-bold tracking-tight"
              style={{
                color: 'rgb(var(--lb-gold))',
                textShadow: '0 0 24px rgb(var(--lb-gold) / 0.5)'
              }}
            >
              {APEX.name}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.3em]"
              style={{
                color: 'rgb(var(--r-legendary))',
                border: '1px solid rgb(var(--r-legendary) / 0.5)',
                background: 'rgb(var(--r-legendary) / 0.06)'
              }}
            >
              LEGENDARY
            </span>
          </div>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-zinc-400 sm:text-[13.5px]">
            {APEX.description} Exactly one copy exists at any moment — take the
            top slot and it transfers to you, along with the Champion&apos;s
            Gold plate. Lose the slot, lose the crown.
          </p>
          <p className="mt-2.5 text-[9px] tracking-[0.3em] text-zinc-600">
            1 OF 1 IN CIRCULATION · CURRENTLY HELD BY{' '}
            <span style={{ color: 'rgb(var(--lb-gold))' }}>@BIRDABO</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function HonorsBody() {
  const [inspect, setInspect] = useState<AchievementDef>(HONOR_TILES[3])
  const inspectColor = RARITY_COLOR[inspect.rarity]
  const inspectUnlocked = UNLOCKED.has(inspect.id)

  return (
    <>
      <Seam alt="02 KM" note="FINAL APPROACH · SERVICE RECORD" />

      <div className="mt-10 sm:mt-14">
        <SectionHeader
          align="center"
          index="04"
          code="SERVICE_RECORD"
          title={<>Twenty-five medals.</>}
          serif={<>earned in the field, never bought.</>}
          body={
            <>
              Milestones, streaks, arsenal, operations — every medal is cut
              from real usage stats. Most pilots retire a handful. One medal
              is different: it can&apos;t be kept, only defended.
            </>
          }
        />
      </div>

      {/* the wall */}
      <div className="mx-auto mt-10 sm:mt-14 max-w-3xl">
        <div
          className="st mb-3 flex items-center justify-between text-[9px] tracking-[0.3em] text-zinc-600"
          style={{ '--d': '340ms' } as CSSProperties}
        >
          <span>
            UNLOCKED{' '}
            <span style={{ color: 'var(--accent)' }} className="tabular-nums">
              <CountUp to={UNLOCKED.size} duration={1400} delay={900} />
              /25
            </span>
          </span>
          <span className="sm:hidden">TAP TO INSPECT</span>
          <span className="hidden sm:block">HOVER TO INSPECT</span>
        </div>

        {/* lx-hw + lx-case: in the light dossier the tiles mount inside one
            dark velvet medal case; in dark mode the page itself is the case */}
        <div className="lx-hw lx-case grid grid-cols-6 gap-2 sm:grid-cols-8">
          {HONOR_TILES.map((def, i) => (
            <Tile key={def.id} def={def} index={i} onHover={setInspect} />
          ))}
        </div>

        {/* inspection line */}
        <div
          className="st lx-paper mt-3 flex min-h-[40px] items-center gap-3 rounded-lg border border-zinc-800/70 bg-[color:var(--panel)] px-4 py-2.5"
          style={{ '--d': '480ms' } as CSSProperties}
        >
          <span style={{ color: inspectColor }}>
            <PixelIcon name={inspect.icon} size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span
              className="font-display text-[12px] font-semibold tracking-wide"
              style={{ color: inspectColor }}
            >
              {inspect.name}
            </span>
            <span className="ml-2 font-sans text-[11.5px] text-zinc-500">
              {inspect.description}
            </span>
          </span>
          <span
            className="shrink-0 text-[8px] tracking-[0.3em]"
            style={{ color: inspectUnlocked ? 'rgb(var(--lb-up))' : 'rgb(var(--z600))' }}
          >
            {inspectUnlocked ? '● UNLOCKED' : '○ SEALED'}
          </span>
        </div>

        {/* APEX */}
        <div className="mt-8">
          <ApexCenterpiece />
        </div>
      </div>

      <style jsx global>{`
        .hn-tile {
          cursor: default;
          transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 260ms ease, box-shadow 260ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .hn-tile:hover {
            transform: translateY(-3px);
            border-color: color-mix(in srgb, var(--hn-c) 75%, transparent);
            box-shadow: 0 8px 26px -10px var(--hn-c);
          }
        }
        .hn-tile:focus-visible {
          outline: 2px solid rgb(var(--accent-rgb) / 0.7);
          outline-offset: 2px;
        }
        .hn-legend-shimmer {
          background: linear-gradient(
            115deg,
            transparent 35%,
            rgb(var(--r-legendary) / 0.12) 50%,
            transparent 65%
          );
          background-size: 260% 100%;
          animation: hn-shimmer 4.5s ease-in-out infinite;
        }
        @keyframes hn-shimmer {
          0%,
          100% {
            background-position: 130% 0;
          }
          50% {
            background-position: -30% 0;
          }
        }
        .hn-apex-halo {
          animation: hn-halo-spin 9s linear infinite;
        }
        @keyframes hn-halo-spin {
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        .hn-apex-beam {
          animation: hn-beam-sweep 5.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes hn-beam-sweep {
          0% {
            transform: translateX(-160%) skewX(-12deg);
          }
          60%,
          100% {
            transform: translateX(900%) skewX(-12deg);
          }
        }
        .hn-crown-bob {
          animation: hn-crown-bob 2.8s ease-in-out infinite;
          filter: drop-shadow(0 0 8px rgb(var(--lb-gold) / 0.75));
        }
        @keyframes hn-crown-bob {
          0%,
          100% {
            transform: translate(-50%, 0) rotate(-2deg);
          }
          50% {
            transform: translate(-50%, -4px) rotate(2deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hn-legend-shimmer,
          .hn-apex-halo,
          .hn-apex-beam,
          .hn-crown-bob {
            animation: none;
          }
          .hn-tile,
          .hn-tile:hover {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </>
  )
}

export function HonorsSection() {
  return (
    <section id="descent-honors" data-sec="honors" className="relative">
      <Stage className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-16 sm:py-24 md:py-32">
        <HonorsBody />
      </Stage>
    </section>
  )
}
