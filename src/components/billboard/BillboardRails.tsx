'use client'

// The profile sponsor rails — 8 always-on ad slots (L1-L4 down the
// left edge, R1-R4 down the right) flanking the profile pages,
// canivibecodeit-style: no rotation, no cooldown, a fixed presence for
// the paid week. Mounted once in AppShell beside the ticker and
// self-gating twice over: the pathname must be a profile route (mirrors
// AppShell's profileRoute) and the viewport must be ≥1440px — tracked
// live via matchMedia — so the columns never collide with the centered
// max-w-3xl profile card. While eligible, every profile pathname
// fetches /api/billboard/rails (the feed is cached server-side like
// the flipper's, so profile-to-profile hops are cheap) and a failed
// attempt retries ~30s later; nothing renders until the first fetch
// succeeds — the loaded gate keeps an OPEN box from ever flashing over
// a sold slot — and then every slot does: a paid card where the slot
// is sold, a vacant-slot CTA deep-linking its own slot into the
// /billboard composer (?slot=L2#pitch) where it isn't. The vacant cell
// is not an ad — no counting redirect, no AD tag — just corner
// brackets and that slot's price pitch (see .billboard-rail-vacant in
// globals.css).
//
// Geometry and motion live in globals.css: two fixed columns pinned
// below the top bar (.billboard-rail-col) of uniform viewport-clamped
// cells (.billboard-rail-cell — the card inside stretches to fit via
// billboard-rail-card-fill), and in left-rail nav mode the LEFT column
// clears var(--nav-rail-w), transitioning in lockstep with the rail's
// expand/collapse. z-30 keeps the cards above the profile backdrop
// (-z-10) and under the nav (z-40), per the ticker's stacking
// conventions. Paid clicks go through the counting redirect, never
// straight to link_url, and buyer text renders as plain text via
// BillboardCard.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { RAIL_SLOT_PRICE_CENTS, RAIL_SLOTS } from '@/lib/billboard'
import type { RailItem, RailSlot } from '@/lib/billboard'
import { BillboardCard } from './BillboardCard'

/** Below this the gutters beside the centered profile card can't hold a
 *  208px card in every nav mode (the expanded rail is the tight case). */
const WIDE_QUERY = '(min-width: 1440px)'

/** Delay before a failed rails fetch is re-attempted. */
const RETRY_DELAY_MS = 30_000

export function BillboardRails() {
  const pathname = usePathname() ?? ''
  // Mirrors AppShell's profileRoute — the pages the rails flank.
  const profileRoute = pathname === '/profile' || pathname.startsWith('/u/')

  // false until the first effect runs, so SSR/hydration render nothing.
  const [wide, setWide] = useState(false)
  const [items, setItems] = useState<RailItem[]>([])
  // Vacant CTAs may only render once we know which slots are sold.
  const [loaded, setLoaded] = useState(false)
  // Bumped RETRY_DELAY_MS after a failed fetch to re-run the fetch
  // effect (the ticker's retryTick, single-shot instead of an interval).
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Fetch keyed on the concrete pathname — not just the eligibility
  // booleans — so profile-to-profile navigation refetches too (the feed
  // is 60s-cached server-side, so repeat hits are cheap). A network
  // failure, non-ok status or malformed body schedules one retry by
  // bumping retryNonce; a retry that fails again re-arms the timer, so
  // attempts keep a ~30s cadence for as long as the visitor stays
  // eligible. Success schedules nothing, and a pending timer dies in
  // the cleanup whenever the deps change or the rails unmount. A failed
  // refetch after an earlier success keeps the previous feed on screen:
  // items/loaded are only ever written on success.
  useEffect(() => {
    if (!profileRoute || !wide) return
    let cancelled = false
    let retryTimer = 0
    const scheduleRetry = () => {
      retryTimer = window.setTimeout(() => setRetryNonce((n) => n + 1), RETRY_DELAY_MS)
    }
    fetch('/api/billboard/rails')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: RailItem[] } | null) => {
        if (cancelled) return
        if (!data || !Array.isArray(data.items)) {
          scheduleRetry()
          return
        }
        setItems(data.items)
        setLoaded(true)
      })
      .catch(() => {
        // Network hiccups and invalid-JSON rejections land here alike.
        if (cancelled) return
        scheduleRetry()
      })
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
    }
  }, [pathname, profileRoute, wide, retryNonce])

  if (!profileRoute || !wide || !loaded) return null

  // Every slot renders — RAIL_SLOTS split by side keeps each column
  // top-to-bottom; the fetched feed only decides paid card vs vacant
  // CTA per slot.
  const columns: { side: 'LEFT' | 'RIGHT'; cls: string; slots: RailSlot[] }[] = [
    { side: 'LEFT', cls: 'billboard-rail-col-left', slots: RAIL_SLOTS.filter((s) => s.startsWith('L')) },
    { side: 'RIGHT', cls: 'billboard-rail-col-right', slots: RAIL_SLOTS.filter((s) => s.startsWith('R')) }
  ]

  return (
    <>
      {columns.map(({ side, cls, slots }) => (
        <aside
          key={side}
          aria-label={`Sponsor rail — ${side.toLowerCase()}`}
          // pointer-events-none on the column so the fixed chassis never
          // blocks the page; each slot cell re-enables its own hits.
          className={`billboard-rail-col ${cls} pointer-events-none fixed z-30`}
        >
          {/* Staggered fade-up per fixed-size cell, sold or open — the
              delay is inline so each column cascades top to bottom;
              billboard-rail-enter's backwards fill covers the wait. */}
          {slots.map((slot, idx) => {
            const item = items.find((i) => i.slot === slot)
            return (
              <div
                key={slot}
                className="billboard-rail-cell billboard-rail-enter pointer-events-auto"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {item ? (
                  <a
                    href={`/api/billboard/${item.id}/click`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
                  >
                    <BillboardCard
                      text={item.text}
                      title={item.companyName ?? (item.linkHost || null)}
                      logoUrl={item.logoUrl}
                      accentColor={item.accentColor ?? null}
                      size="rail"
                      className="billboard-rail-card-fill transition-[border-color,background-color,transform] duration-150 group-hover:border-zinc-600 group-hover:bg-white/[0.06] motion-safe:group-hover:-translate-y-0.5"
                    />
                  </a>
                ) : (
                  /* Not an ad: no /click redirect, no AD tag — the slot
                     code up top, the pitch pinned to the bottom, and the
                     brackets + hatch from .billboard-rail-vacant. */
                  <Link
                    href={`/billboard?slot=${slot}#pitch`}
                    className="billboard-rail-vacant relative flex h-full w-full flex-col justify-between rounded-lg px-3.5 py-3 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 motion-safe:hover:-translate-y-0.5"
                  >
                    <span className="text-[9px] tracking-[0.3em] text-zinc-500">{slot}</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.2em] text-zinc-400">
                        OPEN SLOT
                      </span>
                      <span className="text-[9px] leading-4 tracking-[0.2em] text-zinc-500">
                        ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/WK · TAKE THIS SPACE{' '}
                        <span aria-hidden className="billboard-rail-vacant-arrow">
                          →
                        </span>
                      </span>
                    </span>
                  </Link>
                )}
              </div>
            )
          })}
        </aside>
      ))}
    </>
  )
}
