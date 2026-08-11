'use client'

// Descent stage 03 — THE IDENTITY. A holographic pilot card (the same
// trading-card language as the in-app PlayerCard) with live-swappable
// nameplates straight from the real cosmetics catalog. Pointer tilt +
// glare on the card; plates auto-cycle until the visitor takes the wheel.

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from 'react'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { SocialIcon, ToolIcon } from '@/components/leaderboard/icons'
import { getPlate, PLATE_RARITY_META } from '@/lib/cosmetics/plates'
import { prefersReducedMotion } from '@/lib/motion'
import { SHOWCASE_PLATES } from './data'
import { Seam, SectionHeader, Stage, useStageLive } from './scrollFx'

/* The demo card is the founder's real profile — same numbers the arena sim
   above puts him at, so the two sections corroborate each other. */
const CARD_STATS = [
  { label: 'RANK', value: '#1' },
  { label: 'SCORE', value: '929,369' },
  { label: 'STREAK', value: '92D' },
  { label: 'FOCUS', value: '369H' }
] as const

const CARD_BADGES = [
  { icon: 'rocket', rarity: 'rare', name: 'ESCAPE VELOCITY' },
  { icon: 'starfield', rarity: 'epic', name: 'DEEP SPACE' },
  { icon: 'wings', rarity: 'epic', name: 'SQUADRON LEADER' },
  { icon: 'crown', rarity: 'legendary', name: 'APEX' }
] as const

const CARD_TOOLS = [
  { name: 'Cursor', pct: 41 },
  { name: 'Claude', pct: 24 },
  { name: 'ChatGPT', pct: 19 }
] as const

const RARITY: Record<string, string> = {
  common: 'rgb(var(--r-common))',
  rare: 'rgb(var(--r-rare))',
  epic: 'rgb(var(--r-epic))',
  legendary: 'rgb(var(--r-legendary))',
  mythic: 'rgb(var(--r-mythic))'
}

function PilotCard({ plateId }: { plateId: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const raf = useRef(0)

  const onMove = (e: ReactPointerEvent) => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty('--rx', `${(0.5 - py) * 10}deg`)
      el.style.setProperty('--ry', `${(px - 0.5) * 12}deg`)
      el.style.setProperty('--gx', `${px * 100}%`)
      el.style.setProperty('--gy', `${py * 100}%`)
      el.style.setProperty('--glare', '1')
    })
  }

  const onLeave = () => {
    const el = ref.current
    if (!el) return
    cancelAnimationFrame(raf.current)
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--glare', '0')
  }

  const plate = getPlate(plateId)
  const accent = plate?.render.kind === 'css' ? plate.render.accent : '204 255 0'

  return (
    <div style={{ perspective: '1200px' }}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="id-card lx-hw relative overflow-hidden rounded-2xl"
        style={
          {
            transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))',
            background:
              'linear-gradient(180deg, rgb(255 255 255 / 0.045), transparent 40%), rgb(var(--lb-panel-bg))',
            border: `1px solid rgb(${accent} / 0.35)`,
            boxShadow: `0 30px 80px -30px rgb(0 0 0 / 0.9), 0 0 60px -18px rgb(${accent} / 0.3)`,
            transition: 'border-color 600ms ease, box-shadow 600ms ease'
          } as CSSProperties
        }
      >
        {/* banner — the equipped plate, full bleed */}
        <div className="relative h-[118px] overflow-hidden">
          {/* crossfade: key swap re-mounts, entering layer fades in over the old paint */}
          <div key={plateId} className="id-plate-swap absolute inset-0">
            <PlateLayer plateId={plateId} fade="none" />
          </div>
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, transparent 58%, rgb(var(--lb-panel-bg) / 0.94))'
            }}
          />
          <span
            className="absolute left-4 top-4 rounded-md px-2 py-1 text-[9px] leading-none tracking-[0.3em]"
            style={{
              color: `rgb(${accent})`,
              background: 'rgb(0 0 0 / 0.55)',
              border: `1px solid rgb(${accent} / 0.45)`,
              textShadow: `0 0 10px rgb(${accent} / 0.6)`
            }}
          >
            {plate?.name.toUpperCase() ?? 'PLATE'}
          </span>
          <span
            className="absolute right-4 top-4 rounded bg-black/50 px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
            style={{
              color: 'rgb(var(--lb-gold))',
              border: '1px solid rgb(var(--lb-gold) / 0.5)'
            }}
          >
            FOUNDER
          </span>
        </div>

        {/* identity */}
        <div className="relative px-6 pb-6">
          <div className="-mt-[34px] flex items-end justify-between">
            <div className="relative h-[72px] w-[72px]">
              <span
                aria-hidden
                className="absolute -inset-[3px] rounded-full"
                style={{
                  background: `conic-gradient(from 210deg, rgb(${accent} / 0.9), rgb(${accent} / 0.15), rgb(${accent} / 0.9))`,
                  transition: 'background 600ms ease'
                }}
              />
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: 'inset 0 0 0 3px rgb(var(--lb-panel-bg))' }}
              />
              <span className="absolute inset-[3px] block overflow-hidden rounded-full bg-zinc-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/avatars/birdabo.jpg"
                  alt="@birdabo"
                  className="h-full w-full object-cover"
                />
              </span>
              <span
                className="absolute bottom-1 right-1 h-3 w-3 rounded-full"
                style={{
                  background: 'rgb(var(--lb-up))',
                  boxShadow:
                    '0 0 8px rgb(var(--lb-up) / 0.8), inset 0 0 0 2px rgb(var(--lb-panel-bg))'
                }}
              />
            </div>
            <span className="pb-1 text-[9px] tracking-[0.3em] text-zinc-600">
              EST. 2026 · SEASON 01
            </span>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold tracking-tight text-zinc-50">
              Birdabo
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
              @birdabo
              <span className="text-zinc-600">
                <SocialIcon kind="x" size={9} />
              </span>
            </span>
          </div>
          <p className="mt-1.5 font-sans text-[12.5px] leading-relaxed text-zinc-500">
            Built Cribble to settle an argument. Currently winning it.
          </p>

          {/* flight record */}
          <div className="mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-800/60">
            {CARD_STATS.map((s) => (
              <div
                key={s.label}
                className="flex flex-col gap-1.5 bg-[color:var(--panel)] px-2.5 py-3"
              >
                <span className="text-[7px] tracking-[0.3em] text-zinc-600">{s.label}</span>
                <span className="leading-none tabular-nums [font-family:var(--font-pixel)] text-[11px] text-zinc-100">
                  {s.value}
                </span>
              </div>
            ))}
          </div>

          {/* loadout + service record */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {CARD_TOOLS.map((t) => (
                <span
                  key={t.name}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-300"
                  style={{
                    background: 'rgb(var(--lb-panel-edge) / 0.04)',
                    border: '1px solid rgb(var(--lb-panel-edge) / 0.09)'
                  }}
                >
                  <ToolIcon name={t.name} size={11} />
                  <span className="tabular-nums text-zinc-500">{t.pct}%</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {CARD_BADGES.map((b) => (
                <span
                  key={b.name}
                  title={b.name}
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{
                    color: RARITY[b.rarity],
                    background: 'rgb(var(--lb-panel-edge) / 0.04)',
                    border: '1px solid rgb(var(--lb-panel-edge) / 0.09)'
                  }}
                >
                  <PixelIcon name={b.icon} size={14} />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* holo glare — follows the pointer */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: 'var(--glare, 0)',
            background:
              'radial-gradient(300px circle at var(--gx, 50%) var(--gy, 50%), rgb(255 255 255 / 0.08), transparent 65%)',
            transition: 'opacity 400ms ease'
          }}
        />
      </div>
    </div>
  )
}

function IdentityBody() {
  const live = useStageLive()
  const [plateId, setPlateId] = useState<string>(SHOWCASE_PLATES[0])
  const [autoCycle, setAutoCycle] = useState(true)

  useEffect(() => {
    if (!live || !autoCycle || prefersReducedMotion()) return
    const iv = setInterval(() => {
      setPlateId((prev) => {
        const i = SHOWCASE_PLATES.indexOf(prev as (typeof SHOWCASE_PLATES)[number])
        return SHOWCASE_PLATES[(i + 1) % SHOWCASE_PLATES.length]
      })
    }, 3600)
    return () => clearInterval(iv)
  }, [live, autoCycle])

  return (
    <>
      <Seam alt="11 KM" note="TROPOSPHERE · IDENTITY CONFIRMED" />

      <div className="mt-10 sm:mt-14 grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="lg:pt-4">
          <SectionHeader
            index="03"
            code="PILOT_IDENTITY"
            title={
              <>
                Proof of work,
                <br />
                laminated.
              </>
            }
            serif={<>your grind, pressed into a trading card.</>}
            body={
              <>
                Every pilot gets a card: banner, callsign, flight record,
                medal rack. Skin it with plates from the shop, or with the
                ones money can&apos;t touch. The card on the right belongs
                to <span className="text-zinc-200">@birdabo</span>, the
                founder, currently sitting on #1. Somebody should really do
                something about that.
              </>
            }
            annotation="COSMETICS · CATALOG LIVE"
          />

          {/* plate rack */}
          <div className="mt-9 flex flex-col gap-2.5">
            {SHOWCASE_PLATES.map((id, i) => {
              const plate = getPlate(id)
              if (!plate) return null
              const selected = id === plateId
              const rarity = PLATE_RARITY_META[plate.rarity]
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setAutoCycle(false)
                    setPlateId(id)
                  }}
                  className="st id-rack lx-hw lx-mod group relative overflow-hidden rounded-xl text-left"
                  style={
                    {
                      '--d': `${380 + i * 90}ms`,
                      border: selected
                        ? `1px solid ${rarity.color}`
                        : '1px solid rgb(var(--lb-panel-edge) / 0.1)',
                      boxShadow: selected
                        ? `0 0 26px -10px ${rarity.color}`
                        : undefined
                    } as CSSProperties
                  }
                  aria-pressed={selected}
                >
                  <span className="absolute inset-0" aria-hidden>
                    <PlateLayer plateId={id} />
                  </span>
                  <span
                    className="absolute inset-0"
                    aria-hidden
                    style={{
                      background:
                        'linear-gradient(90deg, rgb(var(--lb-panel-bg) / 0.92) 22%, rgb(var(--lb-panel-bg) / 0.25) 60%, transparent)'
                    }}
                  />
                  <span className="relative z-10 flex items-center justify-between px-4 py-3">
                    <span>
                      <span className="block font-display text-[13px] font-semibold text-zinc-100">
                        {plate.name}
                      </span>
                      <span className="mt-0.5 block text-[9px] tracking-[0.2em] text-zinc-500">
                        {plate.tagline.toUpperCase()}
                      </span>
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
                      style={{
                        color: rarity.color,
                        border: `1px solid ${rarity.color}`,
                        background: 'rgb(0 0 0 / 0.4)'
                      }}
                    >
                      {plate.priceUsd ? rarity.label : 'EARNED'}
                    </span>
                  </span>
                  {selected && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 h-full w-[3px]"
                      style={{ background: rarity.color, boxShadow: `0 0 12px ${rarity.color}` }}
                    />
                  )}
                </button>
              )
            })}
            <p
              className="st mt-1 text-[9px] tracking-[0.3em] text-zinc-700"
              style={{ '--d': '760ms' } as CSSProperties}
            >
              {'// TAP A PLATE · THE CARD RE-SKINS LIVE'}
            </p>
          </div>
        </div>

        {/* the card — scroll-scrubbed float-in + idle hover bob */}
        <div className="id-stage relative">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-4 -top-16 bottom-0 opacity-60 sm:-inset-x-10"
            style={{
              background:
                'radial-gradient(55% 45% at 50% 30%, rgb(var(--accent-rgb) / 0.07), transparent 70%)'
            }}
          />
          <div className="id-float relative mx-auto w-full max-w-[440px]">
            <PilotCard plateId={plateId} />
          </div>
          <p className="mt-4 text-center text-[9px] tracking-[0.3em] text-zinc-700">
            <span className="sm:hidden">
              {'// PLATES FROM THE LIVE CATALOG'}
            </span>
            <span className="hidden sm:inline">
              {'// HOVER TO TILT · PLATES FROM THE LIVE CATALOG'}
            </span>
          </p>
        </div>
      </div>

      <style jsx global>{`
        .id-stage {
          opacity: clamp(0, calc((var(--p, 1) - 0.05) * 4), 1);
          transform: translateY(calc(max(0.45 - var(--p, 1), 0) * 110px))
            rotate(calc(max(0.45 - var(--p, 1), 0) * 4deg));
          will-change: transform;
        }
        .id-card {
          will-change: transform;
          transform-style: preserve-3d;
        }
        .id-float {
          animation: id-idle-bob 7s ease-in-out infinite;
        }
        @keyframes id-idle-bob {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .id-plate-swap {
          animation: id-plate-in 700ms ease backwards;
        }
        @keyframes id-plate-in {
          from {
            opacity: 0;
            filter: saturate(1.6) brightness(1.35);
          }
        }
        .id-rack {
          min-height: 58px;
          /* opaque instrument base: the plate art's left-fade mask must melt
             into dark panel, never into the page behind the row */
          background: rgb(var(--lb-panel-bg));
          transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 260ms ease, box-shadow 260ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .id-rack:hover {
            transform: translateX(4px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .id-stage {
            opacity: 1;
            transform: none;
          }
          .id-float,
          .id-plate-swap {
            animation: none;
          }
          .id-rack,
          .id-rack:hover {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </>
  )
}

export function IdentitySection() {
  return (
    <section id="descent-identity" data-sec="identity" className="relative">
      <Stage
        scrub
        className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-16 sm:py-24 md:py-32"
      >
        <IdentityBody />
      </Stage>
    </section>
  )
}
