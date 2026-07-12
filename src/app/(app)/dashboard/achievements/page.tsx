'use client'

// Achievements — the pilot's service record. Every badge is a hand-drawn
// 12x12 pixel bitmap tinted by rarity; unlocks are evaluated server-side
// after every extension sync and backfilled when this page loads.

import { memo, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import { ErrorScreen } from '@/components/dashboard-v2/ErrorScreen'
import { formatCompact, formatDuration } from '@/components/dashboard-v2/format'
import {
  ACHIEVEMENT_CATEGORIES,
  type AchievementCategory,
  type AchievementIcon,
  type AchievementRarity,
  type AchievementUnit
} from '@/lib/achievements'

interface AchievementRow {
  id: string
  name: string
  description: string
  category: AchievementCategory
  rarity: AchievementRarity
  icon: AchievementIcon
  target: number
  current: number
  unit: AchievementUnit
  unlockedAt: string | null
}

// "ACHIEVEMENTS" in ANSI Shadow block characters, matching the dashboard banner.
const ASCII_ACHIEVEMENTS = String.raw` █████╗  ██████╗██╗  ██╗██╗███████╗██╗   ██╗███████╗███╗   ███╗███████╗███╗   ██╗████████╗███████╗
██╔══██╗██╔════╝██║  ██║██║██╔════╝██║   ██║██╔════╝████╗ ████║██╔════╝████╗  ██║╚══██╔══╝██╔════╝
███████║██║     ███████║██║█████╗  ██║   ██║█████╗  ██╔████╔██║█████╗  ██╔██╗ ██║   ██║   ███████╗
██╔══██║██║     ██╔══██║██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║
██║  ██║╚██████╗██║  ██║██║███████╗ ╚████╔╝ ███████╗██║ ╚═╝ ██║███████╗██║ ╚████║   ██║   ███████║
╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚══════╝  ╚═══╝  ╚══════╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝`

const RARITY_ORDER: AchievementRarity[] = ['common', 'rare', 'epic', 'legendary']

/* Rarity hues resolve through the --r-* vars set in the page-level styles,
   so common/rare/epic/legendary stay legible in both themes. */
const rarityColor = (rarity: AchievementRarity) => `rgb(var(--r-${rarity}))`
const rarityColorA = (rarity: AchievementRarity, alpha: number) =>
  `rgb(var(--r-${rarity}) / ${alpha})`

const CATEGORY_META: Record<
  AchievementCategory,
  { label: string; blurb: string }
> = {
  milestones: { label: 'MILESTONES', blurb: 'LIFETIME SCORE' },
  streaks: { label: 'STREAKS', blurb: 'CONSISTENCY' },
  arsenal: { label: 'ARSENAL', blurb: 'TOOLS & SORTIES' },
  operations: { label: 'OPERATIONS', blurb: 'FIELD CONDUCT' }
}

const FRESH_UNLOCK_WINDOW_MS = 48 * 3_600_000

function formatProgressValue(unit: AchievementUnit, value: number): string {
  switch (unit) {
    case 'points':
      return formatCompact(Math.round(value))
    case 'duration':
      return formatDuration(value)
    case 'days':
    case 'tools':
    case 'visits':
    case 'sessions':
      return Math.round(value).toLocaleString('en-US')
    case 'none':
      return ''
    default: {
      const exhaustive: never = unit
      return exhaustive
    }
  }
}

function formatUnlockDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

/* ---------- badge card ---------- */

/** HUD-style corner brackets, drawn in the card's rarity hue. */
function CornerBrackets() {
  return (
    <span aria-hidden className="pointer-events-none">
      <span className="hud-corner" style={{ top: 7, left: 7, borderWidth: '2px 0 0 2px' }} />
      <span className="hud-corner" style={{ top: 7, right: 7, borderWidth: '2px 2px 0 0' }} />
      <span className="hud-corner" style={{ bottom: 7, left: 7, borderWidth: '0 0 2px 2px' }} />
      <span className="hud-corner" style={{ bottom: 7, right: 7, borderWidth: '0 2px 2px 0' }} />
    </span>
  )
}

// Memoized: 24 cards render once from a single fetch; nothing per-card
// changes afterwards. The card uses the .glass-lite material (no
// backdrop-filter) so a full grid stays cheap on integrated GPUs.
const AchievementCard = memo(function AchievementCard({ row }: { row: AchievementRow }) {
  const unlocked = row.unlockedAt !== null
  const fresh =
    unlocked && Date.now() - new Date(row.unlockedAt as string).getTime() < FRESH_UNLOCK_WINDOW_MS
  const ratio = row.target > 0 ? Math.min(1, row.current / row.target) : 0
  const filledSegments = unlocked ? 12 : Math.min(11, Math.floor(ratio * 12))
  const color = rarityColor(row.rarity)
  const legendary = unlocked && row.rarity === 'legendary'

  return (
    <div
      className="relative overflow-hidden rounded-2xl glass-lite p-4"
      style={
        unlocked
          ? {
              color,
              boxShadow: `inset 0 0 0 1px ${rarityColorA(row.rarity, legendary ? 0.5 : 0.3)}`
            }
          : undefined
      }
    >
      {unlocked && <CornerBrackets />}
      {legendary && (
        <>
          {/* faint gold pinstripes across the whole card */}
          <span aria-hidden className="legendary-stripes pointer-events-none absolute inset-0" />
          {/* light bead sweeping the top edge */}
          <span aria-hidden className="legendary-sweep pointer-events-none absolute top-0 left-0 h-px w-2/5" />
        </>
      )}

      <div className="relative flex items-start gap-3.5">
        {/* icon tile — pixel badge under a faint scanline film */}
        <div
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-lg glass-inset-lite"
          style={{
            color: unlocked ? color : 'rgb(var(--z600))',
            borderColor: unlocked ? rarityColorA(row.rarity, legendary ? 0.55 : 0.3) : undefined
          }}
        >
          <PixelIcon
            name={row.icon}
            size={38}
            className={unlocked ? 'pixel-glow' : 'opacity-55'}
          />
          <div aria-hidden className="pixel-scanlines absolute inset-0 rounded-lg" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className={`truncate text-[11px] tracking-[0.25em] ${
                unlocked ? 'text-zinc-100' : 'text-zinc-500'
              }`}
              style={unlocked ? { textShadow: `0 0 12px ${rarityColorA(row.rarity, 0.45)}` } : undefined}
            >
              {row.name}
            </h3>
            {fresh && (
              <span className="shrink-0 animate-pulse-slow rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[8px] tracking-[0.25em] text-accent">
                NEW
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            {row.description}
          </p>
        </div>

        <span
          className="shrink-0 rounded border px-1.5 py-0.5 text-[8px] tracking-[0.25em]"
          style={{
            color: unlocked ? color : 'rgb(var(--z600))',
            borderColor: unlocked ? rarityColorA(row.rarity, legendary ? 0.7 : 0.4) : 'rgb(var(--z800))',
            backgroundColor: unlocked ? rarityColorA(row.rarity, legendary ? 0.14 : 0.07) : 'transparent',
            boxShadow: legendary ? `0 0 10px ${rarityColorA(row.rarity, 0.35)}` : undefined
          }}
        >
          {row.rarity.toUpperCase()}
        </span>
      </div>

      {/* progress — 12 pixel segments echoing the badge bitmaps */}
      <div className="relative mt-3.5">
        <div className="flex gap-[3px]">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-[1px]"
              style={
                i < filledSegments
                  ? {
                      backgroundColor: unlocked ? color : 'rgb(var(--accent-rgb))',
                      opacity: unlocked ? 0.85 : 0.7,
                      boxShadow: unlocked
                        ? `0 0 6px ${rarityColorA(row.rarity, 0.5)}`
                        : 'none'
                    }
                  : { backgroundColor: 'rgb(var(--z400) / 0.14)' }
              }
            />
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[9px] tracking-[0.2em]">
          {unlocked ? (
            <>
              <span style={{ color }}>◆ UNLOCKED</span>
              <span className="text-zinc-600">
                {formatUnlockDate(row.unlockedAt as string)}
              </span>
            </>
          ) : row.unit === 'none' ? (
            <>
              <span className="text-zinc-600">LOCKED</span>
              <span className="text-zinc-700">CLASSIFIED</span>
            </>
          ) : (
            <>
              <span className="text-zinc-500">
                {formatProgressValue(row.unit, Math.min(row.current, row.target))}
                <span className="text-zinc-700"> / {formatProgressValue(row.unit, row.target)}</span>
              </span>
              <span className="text-zinc-700">{Math.floor(ratio * 100)}%</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

/* ---------- summary strip ---------- */

function SummaryPanel({ rows }: { rows: AchievementRow[] }) {
  const unlocked = rows.filter((r) => r.unlockedAt !== null)
  const pct = rows.length > 0 ? Math.round((unlocked.length / rows.length) * 100) : 0

  return (
    <section className="relative overflow-hidden rounded-2xl glass-lite p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div>
          <div className="text-[9px] tracking-[0.35em] text-zinc-500">DECORATIONS</div>
          <div className="mt-1 font-mono text-2xl text-zinc-100 cribble-score-glow">
            {unlocked.length}
            <span className="text-zinc-600">/{rows.length}</span>
            <span className="ml-3 text-sm text-accent">{pct}%</span>
          </div>
        </div>

        {/* cartridge strip — one cell per achievement, lit in its rarity hue */}
        <div className="min-w-[190px] flex-1">
          <div className="text-[9px] tracking-[0.35em] text-zinc-600">SERVICE STRIP</div>
          <div className="mt-2 flex flex-wrap gap-[3px]">
            {rows.map((r) => (
              <span
                key={r.id}
                title={r.unlockedAt !== null ? r.name : 'LOCKED'}
                className="h-2.5 w-2.5 rounded-[1px]"
                style={
                  r.unlockedAt !== null
                    ? {
                        backgroundColor: rarityColor(r.rarity),
                        boxShadow: `0 0 5px ${rarityColorA(r.rarity, 0.6)}`
                      }
                    : { backgroundColor: 'rgb(var(--z400) / 0.14)' }
                }
              />
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          {RARITY_ORDER.map((rarity) => {
            const total = rows.filter((r) => r.rarity === rarity).length
            const got = unlocked.filter((r) => r.rarity === rarity).length
            return (
              <div key={rarity} className="text-center">
                <div
                  className="text-[9px] tracking-[0.25em]"
                  style={{ color: rarityColor(rarity) }}
                >
                  {rarity.toUpperCase()}
                </div>
                <div className="mt-0.5 font-mono text-sm text-zinc-300">
                  {got}
                  <span className="text-zinc-600">/{total}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ---------- page ---------- */

export default function AchievementsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AchievementRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/user/achievements', { credentials: 'include' })
        if (res.status === 401) {
          router.push('/login')
          return
        }
        const data = await res.json()
        if (cancelled) return
        if (data.success) {
          setRows(data.achievements as AchievementRow[])
        } else {
          setError('Could not load your service record.')
        }
      } catch {
        if (!cancelled) setError('Could not load your service record.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [router])

  const byCategory = useMemo(() => {
    const groups = new Map<AchievementCategory, AchievementRow[]>()
    for (const row of rows ?? []) {
      const list = groups.get(row.category) ?? []
      list.push(row)
      groups.set(row.category, list)
    }
    return groups
  }, [rows])

  if (error) return <ErrorScreen message={error} />

  if (rows === null) {
    return (
      <div className="flex min-h-[calc(100vh-var(--nav-topbar-h))] items-center justify-center font-mono text-zinc-100">
        <div className="relative z-10 text-center">
          <div className="text-[10px] tracking-[0.4em] text-accent retro-glow">
            ACCESSING SERVICE RECORD
          </div>
          <div className="mt-3 text-[10px] tracking-[0.3em] text-zinc-600">
            <span className="animate-pulse-slow">█ DECRYPTING…</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ach-root page-zoom-out ach-reveal-root relative mx-auto max-w-6xl px-6 pb-10 pt-6">
        <section className="mt-4 flex flex-col items-center gap-2">
          <div className="w-full overflow-x-auto py-1">
            <pre
              aria-label="ACHIEVEMENTS"
              className="mx-auto whitespace-pre text-center font-mono leading-[0.9] text-accent"
              style={{
                fontSize: 'clamp(3.4px, 0.6vw, 7.4px)',
                textShadow:
                  '0 0 8px rgb(var(--accent-rgb)/0.33), 0 0 22px rgb(var(--accent-rgb)/0.15)',
                letterSpacing: '-0.02em'
              }}
            >
              {ASCII_ACHIEVEMENTS}
            </pre>
          </div>
          <p className="text-center text-[10px] tracking-[0.3em] text-zinc-600">
            <span className="text-accent/80">{'// '}</span>
            service record
            <span className="mx-2 text-zinc-800">·</span>
            {rows.filter((r) => r.unlockedAt !== null).length}/{rows.length} decorations earned
          </p>
        </section>

        <main className="mt-8 space-y-8">
          <SummaryPanel rows={rows} />

          {ACHIEVEMENT_CATEGORIES.map((category) => {
            const list = byCategory.get(category) ?? []
            if (list.length === 0) return null
            const meta = CATEGORY_META[category]
            const got = list.filter((r) => r.unlockedAt !== null).length
            return (
              <section key={category}>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-[10px] tracking-[0.4em] text-zinc-300">
                    <span className="text-accent/80">{'// '}</span>
                    {meta.label}
                  </h2>
                  <span className="hidden text-[9px] tracking-[0.25em] text-zinc-600 sm:inline">
                    {meta.blurb}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-[9px] tracking-[0.25em] text-accent/70">
                    {got}/{list.length}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((row) => (
                    <AchievementCard key={row.id} row={row} />
                  ))}
                </div>
              </section>
            )
          })}
        </main>

        <footer className="mt-10 flex items-center justify-between text-[10px] tracking-[0.3em] text-zinc-600">
          <span>CRIBBLE · PRIVATE BETA</span>
          <span className="text-accent/60">SERVICE RECORD · {new Date().toLocaleDateString('en-US')}</span>
        </footer>

      <style jsx global>{`
        /* Rarity palette (--r-*) comes from globals.css, shared with the
           notification bell. */

        /* HUD corner brackets — inherit the card's rarity hue via
           currentColor (set on the card root when unlocked). */
        .hud-corner {
          position: absolute;
          width: 9px;
          height: 9px;
          border-style: solid;
          border-color: currentColor;
          opacity: 0.55;
        }

        /* LEGENDARY: faint gold pinstripes + a light bead tracing the top
           edge. Both are plain gradients / compositor-only transforms —
           no filters. */
        .legendary-stripes {
          background: repeating-linear-gradient(
            135deg,
            rgb(var(--r-legendary) / 0.045) 0px,
            rgb(var(--r-legendary) / 0.045) 1px,
            transparent 1px,
            transparent 9px
          );
        }
        .legendary-sweep {
          background: linear-gradient(
            90deg,
            transparent,
            rgb(var(--r-legendary) / 0.9) 50%,
            transparent
          );
          animation: legendary-sweep 4200ms cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes legendary-sweep {
          0% {
            transform: translateX(-100%);
          }
          60%,
          100% {
            transform: translateX(350%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .legendary-sweep {
            animation: none;
            opacity: 0;
          }
        }

        /* unlocked badge bitmaps glow in their rarity hue */
        .pixel-glow {
          filter: drop-shadow(0 0 5px currentColor);
        }

        /* faint CRT film over each badge tile */
        .pixel-scanlines {
          pointer-events: none;
          background: repeating-linear-gradient(
            180deg,
            rgb(0 0 0 / 0.14) 0px,
            rgb(0 0 0 / 0.14) 1px,
            transparent 1px,
            transparent 3px
          );
        }
        html.light .pixel-scanlines {
          background: repeating-linear-gradient(
            180deg,
            rgb(255 255 255 / 0.28) 0px,
            rgb(255 255 255 / 0.28) 1px,
            transparent 1px,
            transparent 3px
          );
        }

        /* entrance cascade — banner → summary → sections */
        .ach-reveal-root > section,
        .ach-reveal-root > main > *,
        .ach-reveal-root > footer {
          animation: ach-reveal-in 760ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--ad-base, 0ms);
        }
        .ach-reveal-root > section {
          --ad-base: 0ms;
        }
        .ach-reveal-root > main > *:nth-child(1) {
          --ad-base: 100ms;
        }
        .ach-reveal-root > main > *:nth-child(2) {
          --ad-base: 200ms;
        }
        .ach-reveal-root > main > *:nth-child(3) {
          --ad-base: 300ms;
        }
        .ach-reveal-root > main > *:nth-child(4) {
          --ad-base: 400ms;
        }
        .ach-reveal-root > main > *:nth-child(5) {
          --ad-base: 500ms;
        }
        .ach-reveal-root > footer {
          --ad-base: 600ms;
        }

        /* opacity/transform only — animating filter: blur() across ~30
           elements at once is a first-paint GPU spike on low-memory
           machines, and the cards land too fast for the unblur to read. */
        @keyframes ach-reveal-in {
          from {
            opacity: 0;
            transform: translateY(16px) scale(0.985);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ach-reveal-root > section,
          .ach-reveal-root > main > *,
          .ach-reveal-root > footer {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
