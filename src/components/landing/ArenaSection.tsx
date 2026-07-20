'use client'

// Descent stage 01 — THE ARENA. A living preview of the global leaderboard:
// six simulated pilots whose scores tick upward on a randomized clock, with
// real FLIP reordering when someone overtakes the row above. The board panel
// itself pitches in from a re-entry angle, driven by scroll (--p from Stage).

import {
  CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import Link from 'next/link'
import AnimatedCounter from '@/components/AnimatedCounter'
import { PlateLayer } from '@/components/cosmetics/PlateLayer'
import { formatNumber } from '@/components/dashboard-v2/format'
import { IconCrown, SocialIcon, ToolIcon } from '@/components/leaderboard/icons'
import { prefersReducedMotion } from '@/lib/motion'
import { ARENA_STATS, SIM_ROSTER, type SimPilot } from './data'
import { CountUp, Seam, SectionHeader, Stage, useStageLive } from './scrollFx'

const MEDALS = ['var(--lb-gold)', 'var(--lb-silver)', 'var(--lb-bronze)']

function useArenaSim() {
  const live = useStageLive()
  const [pilots, setPilots] = useState<SimPilot[]>(SIM_ROSTER)
  const [gain, setGain] = useState<{ id: string; amt: number; seq: number } | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!live || prefersReducedMotion()) return
    const pool = SIM_ROSTER.flatMap((p) => Array<string>(p.heat).fill(p.id))

    // Dramaturgy: the crown never falls — @Birdabo holds #1 — but the fight
    // stays hot. Challengers take runs at the leader; the moment the gap
    // gets thin the champion answers with a counter-surge. Meanwhile the
    // silver duel below flips ranks while you watch. Max challenger surge
    // (1100) < defense trigger (1800), so the counter always lands in time.
    const tick = () => {
      if (document.hidden) return
      setPilots((prev) => {
        const leader = prev[0]
        let id: string
        let amt: number
        if (leader.score - prev[1].score < 1800) {
          id = leader.id
          amt = 1700 + Math.floor(Math.random() * 900)
        } else {
          const r = Math.random()
          if (r < 0.34) {
            // silver duel — #3 lunges at #2
            id = prev[2].id
            amt = 520 + Math.floor(Math.random() * 580)
          } else if (r < 0.52) {
            // a run at the champion
            id = prev[1].id
            amt = 480 + Math.floor(Math.random() * 620)
          } else {
            id = pool[Math.floor(Math.random() * pool.length)]
            amt = 160 + Math.floor(Math.random() * 680)
          }
          // The crown never falls: if a surge would clear the champion,
          // the champion answers on the same tick instead.
          const target = prev.find((p) => p.id === id)
          if (target && id !== leader.id && target.score + amt > leader.score - 140) {
            id = leader.id
            amt = 1700 + Math.floor(Math.random() * 900)
          }
        }
        setGain({ id, amt, seq: ++seqRef.current })
        return prev
          .map((p) =>
            p.id === id ? { ...p, score: p.score + amt, today: p.today + amt } : p
          )
          .sort((a, b) => b.score - a.score)
      })
    }
    const first = setTimeout(tick, 1600)
    const iv = setInterval(tick, 2200)
    return () => {
      clearTimeout(first)
      clearInterval(iv)
    }
  }, [live])

  return { pilots, gain }
}

function Row({
  pilot,
  rank,
  gain,
  refFn,
  entranceDelay
}: {
  pilot: SimPilot
  rank: number
  gain: { id: string; amt: number; seq: number } | null
  refFn: (el: HTMLDivElement | null) => void
  entranceDelay: number
}) {
  const medal = rank <= 3 ? MEDALS[rank - 1] : null
  const champion = rank === 1
  const gained = gain?.id === pilot.id ? gain : null

  return (
    <div
      ref={refFn}
      className="st ar-row relative overflow-hidden rounded-xl"
      style={
        {
          '--d': `${entranceDelay}ms`,
          background: champion
            ? 'linear-gradient(90deg, rgb(var(--lb-gold) / 0.07), transparent 55%), rgb(var(--lb-panel-bg))'
            : 'rgb(var(--lb-panel-bg))',
          border: medal
            ? `1px solid rgb(${medal} / ${champion ? 0.4 : 0.22})`
            : '1px solid rgb(var(--lb-panel-edge) / 0.08)'
        } as CSSProperties
      }
    >
      {pilot.plate && (
        <>
          <PlateLayer plateId={pilot.plate} />
          {/* seat the score: plate art runs full-strength on the right,
              exactly where the numerals sit — this scrim grounds them */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, transparent 52%, rgb(var(--lb-panel-bg) / 0.88) 86%)'
            }}
          />
        </>
      )}

      <div className="relative z-10 grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 sm:grid-cols-[44px_minmax(0,1fr)_80px_62px_auto] sm:gap-2.5 sm:px-4 sm:py-2.5">
        {/* rank */}
        <span
          className="leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            fontSize: champion ? 17 : 13,
            color: medal ? `rgb(${medal})` : 'rgb(var(--z500))',
            textShadow: medal ? `0 0 14px rgb(${medal} / 0.5)` : undefined
          }}
        >
          {rank}
        </span>

        {/* identity */}
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-full font-display text-[13px] font-bold"
            style={{
              background: 'rgb(var(--lb-panel-edge) / 0.06)',
              border: medal
                ? `1px solid rgb(${medal} / 0.55)`
                : '1px solid rgb(var(--lb-panel-edge) / 0.16)',
              color: medal ? `rgb(${medal})` : 'rgb(var(--z300))'
            }}
          >
            {pilot.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pilot.avatar}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full rounded-full object-cover"
              />
            ) : (
              pilot.name[0].toUpperCase()
            )}
            {pilot.online && (
              <span
                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
                style={{
                  background: 'rgb(var(--lb-up))',
                  boxShadow:
                    '0 0 6px rgb(var(--lb-up) / 0.8), inset 0 0 0 1.5px rgb(var(--lb-panel-bg))'
                }}
              />
            )}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              {champion && (
                <span className="text-[rgb(var(--lb-gold))]">
                  <IconCrown size={12} />
                </span>
              )}
              <span className="truncate font-display text-[13px] font-semibold tracking-tight text-zinc-100">
                {pilot.callsign}
              </span>
              <span className="shrink-0 text-zinc-600">
                <SocialIcon kind="x" size={9} />
              </span>
            </span>
            <span className="block truncate text-[9px] tracking-[0.1em] text-zinc-600">
              {pilot.name.toUpperCase()} · {pilot.org}
            </span>
          </span>
        </span>

        {/* top tool */}
        <span className="hidden items-center gap-2 text-zinc-400 sm:flex">
          <ToolIcon name={pilot.tool} size={13} />
          <span className="font-display text-[11px]">{pilot.tool}</span>
        </span>

        {/* 24h */}
        <span
          className="hidden text-right text-[11px] tabular-nums sm:block"
          style={{ color: 'rgb(var(--lb-up))' }}
        >
          +<AnimatedCounter value={pilot.today} duration={900} formatter={(v) => formatNumber(Math.round(v))} />
        </span>

        {/* score */}
        <span className="relative text-right">
          <span
            className="leading-none tabular-nums [font-family:var(--font-pixel)] text-[13px] sm:text-[14px]"
            style={{
              color: medal ? `rgb(${medal})` : 'rgb(var(--z200))',
              textShadow: medal ? `0 0 16px rgb(${medal} / 0.45)` : undefined
            }}
          >
            <AnimatedCounter
              value={pilot.score}
              duration={900}
              formatter={(v) => formatNumber(Math.round(v))}
            />
          </span>
          {gained && (
            <span key={gained.seq} className="ar-gain" aria-hidden>
              +{formatNumber(gained.amt)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function ArenaBody() {
  const { pilots, gain } = useArenaSim()
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const prevTops = useRef(new Map<string, number>())
  const prevOrder = useRef<string[]>(SIM_ROSTER.map((p) => p.id))
  const order = pilots.map((p) => p.id).join('|')

  // FLIP: rows glide from their previous slot into the new one; a climber
  // gets a gold edge-flash so the overtake reads even in peripheral vision.
  useLayoutEffect(() => {
    const next = new Map<string, number>()
    rowRefs.current.forEach((el, id) => next.set(id, el.getBoundingClientRect().top))

    const ids = pilots.map((p) => p.id)
    next.forEach((top, id) => {
      const old = prevTops.current.get(id)
      const el = rowRefs.current.get(id)
      if (old == null || !el) return
      const dy = old - top
      if (Math.abs(dy) < 2) return
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 640, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      )
      if (prevOrder.current.indexOf(id) > ids.indexOf(id)) {
        el.animate(
          [
            {
              boxShadow:
                'inset 0 0 0 1px rgb(255 214 68 / 0.75), 0 0 30px -6px rgb(255 214 68 / 0.55)'
            },
            { boxShadow: 'inset 0 0 0 1px rgb(255 214 68 / 0)' }
          ],
          { duration: 1000, easing: 'ease-out' }
        )
      }
    })
    prevTops.current = next
    prevOrder.current = ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

  return (
    <>
      <Seam alt="82 KM" note="MESOSPHERE · ENTERING THE ARENA" />

      <div className="mt-10 sm:mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        <div>
          <SectionHeader
            index="01"
            code="GLOBAL_LEADERBOARD"
            title={
              <>
                One board.
                <br />
                Every pilot.
              </>
            }
            serif={
              <>
                somebody holds{' '}
                <span style={{ color: 'rgb(var(--lb-gold))' }}>#1</span>. it
                isn&apos;t you. yet.
              </>
            }
            body={
              <>
                No brackets, no regions, no casual queue. Every pilot on
                Earth shares one table, and it re-sorts the moment anyone
                syncs a session, so overtakes land while you scroll. The
                board on the right is the real machinery with a staged
                cast. The live one is meaner.
              </>
            }
          />

          {/* stat bar — page-level data: printed cells on the light dossier,
              black modules in the dark habitat */}
          <div className="lx-statgrid mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-800/60 sm:grid-cols-4">
            {ARENA_STATS.map((s, i) => (
              <div
                key={s.label}
                className="st lx-statcell flex flex-col gap-2 bg-black px-4 py-4"
                style={{ '--d': `${340 + i * 70}ms` } as CSSProperties}
              >
                <span className="flex items-center gap-1.5 text-[8px] tracking-[0.3em] text-zinc-600">
                  {s.live && (
                    <span
                      className="ar-live-dot h-1 w-1 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                  {s.label}
                </span>
                <span className="leading-none tabular-nums [font-family:var(--font-pixel)] text-[15px] text-zinc-100">
                  {s.format === 'days' ? (
                    <>
                      <CountUp to={s.value} duration={1200} delay={400 + i * 120} />
                      <span className="ml-1 text-[9px] text-zinc-600">DAYS</span>
                    </>
                  ) : (
                    <CountUp to={s.value} duration={1600} delay={400 + i * 120} />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* the board — pitches in from a re-entry angle as you scroll.
            lx-hw: a fixed dark instrument in both themes (see Descent). */}
        <div className="ar-board" style={{ transformOrigin: '50% 0%' }}>
          <div
            className="lx-hw ar-panel relative overflow-hidden rounded-2xl p-4 sm:p-5"
            style={{
              background:
                'linear-gradient(180deg, rgb(255 255 255 / 0.035), rgb(255 255 255 / 0.008) 42%, transparent), rgb(var(--lb-panel-bg))',
              border: '1px solid rgb(var(--lb-panel-edge) / 0.09)'
            }}
          >
            {/* gold arena spotlight */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-40"
              style={{
                background:
                  'radial-gradient(60% 100% at 50% 0%, rgb(var(--lb-gold) / 0.08), transparent 70%)'
              }}
            />

            <div className="relative flex items-center justify-between pb-3">
              <span className="text-[9px] tracking-[0.35em] text-zinc-500">
                STANDINGS · SEASON 01
              </span>
              <span
                className="flex items-center gap-1.5 rounded border px-2 py-1 text-[8px] tracking-[0.3em]"
                style={{
                  color: 'var(--accent)',
                  borderColor: 'rgb(var(--accent-rgb) / 0.4)',
                  background: 'rgb(var(--accent-rgb) / 0.06)'
                }}
              >
                <span
                  className="ar-live-dot h-1 w-1 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
                LIVE SIM
              </span>
            </div>

            <div className="relative flex flex-col gap-1.5">
              {pilots.map((p, i) => (
                <Row
                  key={p.id}
                  pilot={p}
                  rank={i + 1}
                  gain={gain}
                  entranceDelay={220 + i * 80}
                  refFn={(el) => {
                    if (el) rowRefs.current.set(p.id, el)
                    else rowRefs.current.delete(p.id)
                  }}
                />
              ))}

              {/* your slot */}
              <Link
                href="/login"
                className="st ar-you group relative mt-1.5 flex items-center justify-between rounded-xl px-4 py-3"
                style={{ '--d': '760ms' } as CSSProperties}
              >
                <span className="flex items-center gap-3">
                  <span className="leading-none [font-family:var(--font-pixel)] text-[11px] text-zinc-600">
                    ????
                  </span>
                  <span className="text-[11px] tracking-[0.2em] text-zinc-400">
                    THIS SLOT IS OPEN
                  </span>
                </span>
                <span
                  className="flex items-center gap-2 text-[10px] tracking-[0.2em] transition-transform group-hover:translate-x-1"
                  style={{ color: 'var(--accent)' }}
                >
                  TAKE A NUMBER →
                </span>
              </Link>
            </div>
          </div>

          <p
            className="st mt-3 text-right text-[9px] tracking-[0.3em] text-zinc-700"
            style={{ '--d': '860ms' } as CSSProperties}
          >
            {'// SIMULATION · DREAM LINEUP, STAGED SCORES. THE MECHANICS ARE REAL'}
          </p>
        </div>
      </div>

      <style jsx global>{`
        .ar-board {
          opacity: clamp(0, calc((var(--p, 1) - 0.04) * 4), 1);
          transform: perspective(1100px)
            rotateX(calc(max(0.42 - var(--p, 1), 0) * 30deg))
            translateY(calc(max(0.42 - var(--p, 1), 0) * 90px));
          will-change: transform;
        }
        .ar-panel {
          box-shadow: 0 22px 48px -26px rgb(0 0 0 / 0.85);
        }
        /* on the light dossier the board is a dark slab sitting on paper —
           it needs a real object shadow, warm like the page */
        html.light .ar-panel {
          box-shadow:
            0 36px 80px -38px rgb(52 45 24 / 0.6),
            0 14px 30px -18px rgb(52 45 24 / 0.35);
        }
        .ar-live-dot {
          box-shadow: 0 0 8px rgb(var(--accent-rgb) / 0.8);
          animation: ar-live-pulse 1.6s ease-in-out infinite;
        }
        @keyframes ar-live-pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.35;
            transform: scale(0.8);
          }
        }
        .ar-gain {
          position: absolute;
          right: 0;
          top: -4px;
          font-size: 10px;
          letter-spacing: 0.06em;
          color: rgb(var(--lb-up));
          text-shadow: 0 0 10px rgb(var(--lb-up) / 0.6);
          animation: ar-gain-float 1.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          pointer-events: none;
        }
        @keyframes ar-gain-float {
          0% {
            opacity: 0;
            transform: translateY(6px);
          }
          18% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(-16px);
          }
        }
        .ar-you {
          border: 1px dashed rgb(var(--accent-rgb) / 0.35);
          background: rgb(var(--accent-rgb) / 0.03);
          transition: border-color 240ms ease, background-color 240ms ease;
        }
        .ar-you:hover {
          border-color: rgb(var(--accent-rgb) / 0.7);
          background: rgb(var(--accent-rgb) / 0.07);
        }
        @media (prefers-reduced-motion: reduce) {
          .ar-live-dot,
          .ar-gain {
            animation: none;
          }
          .ar-board {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </>
  )
}

export function ArenaSection() {
  return (
    <section id="descent-arena" data-sec="arena" className="relative">
      <Stage
        scrub
        className="page-zoom-out mx-auto w-full max-w-6xl px-6 py-16 sm:py-24 md:py-32"
      >
        <ArenaBody />
      </Stage>
    </section>
  )
}
