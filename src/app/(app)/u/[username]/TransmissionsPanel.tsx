'use client'

// TRANSMISSIONS — the profile's sponsor panel (migration 035): the 8
// always-on rail slots (L1-L4, R1-R4) as one framed list inside the
// dossier's spine from 1024px up. Replaces the retired fixed rail
// columns with the same slot ids, prices and feed — /api/billboard/rails
// via useRailFeed — and the same rules: no rotation, one slot per buyer,
// a fixed presence for the paid week. No slot row renders until the first
// fetch succeeds, so an OPEN row never flashes over a sold slot; until
// then the same framed chassis holds the header and eight skeleton rows
// on the live rows' exact box (every slot row — sold, open, skeleton — is
// 48px: a fixed two-line text column plus py-2), so the RECRUIT frame
// below it in the spine does not move when the feed lands, whatever the
// sold/open mix.
// useRailFeed has no terminal failure — it retries on a ~30s cadence for
// as long as it is enabled — so once an attempt fails the skeleton gives
// way to the same eight rows as hatched vacant slots (no pulse), the
// first carrying one quiet FEED OFFLINE line, and stays there until a
// retry succeeds: the slots are physical and a dead feed does not
// remove them, so the frame is the same height in every phase. Sold
// rows go through the counting redirect (/api/billboard/[id]/click), never to
// link_url, and buyer text renders as plain text. Open rows are not ads
// — no redirect, no SPONSOR tag — just the slot's price pitch
// deep-linked into the /sponsorship composer (?slot=L2#pitch). Paper
// tokens and the .pf-* recipes live in dossier.css; .pf-row is the
// motion hook's stagger hook and only the live rows carry it — the
// skeleton and the offline slots must not be staggered. `enabled` gates the
// fetch itself: the spine hands in a matchMedia (min-width: 1024px) flag
// so phones, where the panel is display:none, never request the feed.

import { useState } from 'react'
import Link from 'next/link'
import { RAIL_SLOT_PRICE_CENTS, RAIL_SLOTS } from '@/lib/billboard'
import type { RailItem, RailSlot } from '@/lib/billboard'
import { useRailFeed } from '@/components/billboard/useRailFeed'

export type TransmissionRow = {
  slot: RailSlot
  /** The live occupant; null while the slot is open. */
  item: RailItem | null
  /** Sticker price per week in whole dollars. */
  priceUsd: number
}

/** Every slot renders, in RAIL_SLOTS order — the feed only decides sold
 *  vs open per slot. Pure so the mapping is testable without a DOM. */
export function slotRows(items: RailItem[]): TransmissionRow[] {
  return RAIL_SLOTS.map((slot) => ({
    slot,
    item: items.find((i) => i.slot === slot) ?? null,
    priceUsd: RAIL_SLOT_PRICE_CENTS[slot] / 100
  }))
}

/** Title line of a sold row: the company name, else the link host, else
 *  nothing (a pre-034 ad whose stored URL failed to parse). */
export function rowTitle(item: RailItem): string | null {
  return item.companyName || item.linkHost || null
}

/** What the panel body shows. A landed feed always wins — a failed
 *  refetch keeps the previous feed — so `offline` only ever describes a
 *  first fetch that failed and is waiting on the hook's retry cadence.
 *  Pure so the precedence is testable without a DOM. */
export type TransmissionsPhase = 'loading' | 'offline' | 'ready'

export function panelPhase(feed: { loaded: boolean; failed: boolean }): TransmissionsPhase {
  if (feed.loaded) return 'ready'
  return feed.failed ? 'offline' : 'loading'
}

/** Row box: 40px minimum, logo / lines / slot code across, padded by the
 *  framed-panel inset. The skeleton and offline slots sit on this alone. */
const ROW_BOX = 'flex min-h-10 items-center gap-3 px-[var(--pf-inset)] py-2'
/** The text column of every slot row: a fixed 32px (two 16px lines), so
 *  sold, open and skeleton rows are all exactly 48px (32 + py-2) and the
 *  frame's height is the same before and after the feed lands whatever
 *  the sold/open mix. A sold row with no title centres its one line. */
const LINES = 'flex h-8 min-w-0 flex-1 flex-col justify-center'
/** 16px line box for a .pf-micro line (its own line-height is 12px). */
const MICRO_LINE = 'flex h-4 items-center'
/** A live row: the box plus the stagger hook and hover (focus is the
 *  sheet's rule, dossier.css). */
const ROW = `pf-row ${ROW_BOX} transition-colors hover:bg-[color:var(--pf-paper-3)]`
const LIST = 'divide-y divide-[color:var(--pf-line-soft)]'
/** Loading bars: paper-2 blocks, pulse only when motion is allowed. */
const SKELETON = 'bg-[color:var(--pf-paper-2)] animate-pulse motion-reduce:animate-none'

export function TransmissionsPanel({
  enabled = true,
  className = ''
}: {
  /** False below lg (the spine passes a matchMedia flag) so phones never
   *  pay for a feed the panel cannot show. */
  enabled?: boolean
  className?: string
}) {
  const feed = useRailFeed(enabled)
  const phase = panelPhase(feed)
  const rows = slotRows(feed.items)
  const sold = rows.filter((r) => r.item !== null).length

  // One <aside> in every phase, so the node the boot unfolds (.pf-panel)
  // is the node the feed later fills — only the body swaps.
  return (
    <aside
      aria-label="Transmissions — sponsor slots"
      className={`pf-panel pf-frame hidden lg:block ${className}`}
    >
      {/* label-left, one rule, a SOLD/TOTAL readout right. The panel's
          inner width at lg is ~230px (296 - 2 x gutter - 2 x inset), so
          a centred title with rules on both sides (or an "8 SLOTS"
          aside) would overflow and get clipped. */}
      <header className="flex items-center gap-3 px-[var(--pf-inset)] py-2">
        <span className="pf-label shrink-0">[ TRANSMISSIONS ]</span>
        <div className="pf-rule min-w-3 flex-1" />
        <Readout phase={phase} sold={sold} />
      </header>
      <Body phase={phase} rows={rows} />
    </aside>
  )
}

/** SOLD/TOTAL once the feed is in; a dash for the count before that so
 *  the header keeps its width. */
function Readout({ phase, sold }: { phase: TransmissionsPhase; sold: number }) {
  switch (phase) {
    case 'ready':
      return (
        <span className="pf-micro shrink-0" aria-label={`${sold} of ${RAIL_SLOTS.length} slots taken`}>
          {sold}/{RAIL_SLOTS.length}
        </span>
      )
    case 'loading':
    case 'offline':
      return (
        <span className="pf-micro shrink-0" aria-hidden>
          –/{RAIL_SLOTS.length}
        </span>
      )
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

function Body({ phase, rows }: { phase: TransmissionsPhase; rows: TransmissionRow[] }) {
  switch (phase) {
    case 'ready':
      return (
        <ul className={LIST}>
          {rows.map(({ slot, item, priceUsd }) => (
            <li key={slot}>
              {item ? <SoldRow slot={slot} item={item} /> : <OpenRow slot={slot} priceUsd={priceUsd} />}
            </li>
          ))}
        </ul>
      )
    case 'loading':
      return (
        <ul className={LIST} aria-busy="true">
          {RAIL_SLOTS.map((slot) => (
            <li key={slot}>
              <SkeletonRow />
            </li>
          ))}
        </ul>
      )
    case 'offline':
      return (
        <ul className={LIST}>
          {RAIL_SLOTS.map((slot, i) => (
            <li key={slot}>
              <OfflineSlot slot={slot} status={i === 0 ? 'FEED OFFLINE' : null} />
            </li>
          ))}
        </ul>
      )
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

/** A slot while the feed is down: the live rows' 48px box on the open
 *  rows' hatch, no logo well, its code on the right — the slot is still
 *  there, only the feed is not. The first slot's LINES column prints the
 *  one status line; the rest stay blank. Without .pf-row (the motion
 *  hook must not stagger placeholders). */
function OfflineSlot({ slot, status }: { slot: RailSlot; status: string | null }) {
  return (
    <div className={`${ROW_BOX} pf-hatch`}>
      <span className={LINES}>
        {status !== null && (
          <span className={MICRO_LINE}>
            <span className="pf-micro" role="status">
              {status}
            </span>
          </span>
        )}
      </span>
      <span className="pf-micro shrink-0">{slot}</span>
    </div>
  )
}

/** One placeholder row on the live rows' box, without .pf-row (the
 *  motion hook must not stagger placeholders): a paper-2 square where the
 *  logo goes, two bars in the same LINES column (two 16px line boxes) the
 *  live rows' text occupies, a short bar for the slot code — so the row
 *  is exactly a live row's 48px and the list's height never changes when
 *  the feed lands. */
function SkeletonRow() {
  return (
    <div className={ROW_BOX} aria-hidden>
      <span className={`h-5 w-5 shrink-0 ${SKELETON}`} />
      <span className={LINES}>
        <span className={MICRO_LINE}>
          <span className={`h-2 w-24 ${SKELETON}`} />
        </span>
        <span className={MICRO_LINE}>
          <span className={`h-1.5 w-32 ${SKELETON}`} />
        </span>
      </span>
      <span className={`${MICRO_LINE} shrink-0`}>
        <span className={`h-1.5 w-4 ${SKELETON}`} />
      </span>
    </div>
  )
}

function SoldRow({ slot, item }: { slot: RailSlot; item: RailItem }) {
  const title = rowTitle(item)
  return (
    <a
      href={`/api/billboard/${item.id}/click`}
      target="_blank"
      rel="noopener noreferrer"
      className={ROW}
    >
      <Logo src={item.logoUrl} />
      <span className={LINES}>
        {title && (
          <span className="truncate text-[11px] leading-4" style={{ color: 'var(--pf-ink)' }}>
            {title}
          </span>
        )}
        <span className="truncate text-[10px] leading-4" style={{ color: 'var(--pf-ink-2)' }}>
          {item.text}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="pf-micro">{slot}</span>
        <span className="pf-micro">SPONSOR</span>
      </span>
    </a>
  )
}

function OpenRow({ slot, priceUsd }: { slot: RailSlot; priceUsd: number }) {
  return (
    <Link href={`/sponsorship?slot=${slot}#pitch`} className={`${ROW} pf-hatch`}>
      <HollowSquare />
      <span className={LINES}>
        <span
          className="truncate text-[11px] leading-4 tracking-[0.2em]"
          style={{ color: 'var(--pf-ink-2)' }}
        >
          OPEN · ${priceUsd}/WK
        </span>
        {/* the micro line sits in a 16px box so this row is as tall as a
            sold one (whose second line is 11px/leading-4) */}
        <span className={MICRO_LINE}>
          <span className="pf-micro truncate">
            TAKE THIS SLOT <span aria-hidden>→</span>
          </span>
        </span>
      </span>
      <span className="pf-micro shrink-0">{slot}</span>
    </Link>
  )
}

/** 20px logo printed into the sheet through its .pf-print recipe, so it
 *  follows the material in both themes (sepia press on paper, cyanotype
 *  on blueprint). A dead URL — twimg avatars go stale — falls back to
 *  the hollow square the open rows wear, never the broken-image glyph. */
function Logo({ src }: { src: string | null }) {
  const [dead, setDead] = useState(false)
  if (!src || dead) return <HollowSquare />
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setDead(true)}
      className="pf-print h-5 w-5 shrink-0 object-cover"
    />
  )
}

function HollowSquare() {
  return <span aria-hidden className="block h-5 w-5 shrink-0 border" style={{ borderColor: 'var(--pf-line)' }} />
}
