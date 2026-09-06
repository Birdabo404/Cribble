'use client'

// Whole-board context preview for the sponsorship review queue: the
// three placement surfaces (leaderboard sponsor board, dashboard
// flipper strip, the profile TRANSMISSIONS panel's eight rail slots)
// composed from the same public components those surfaces ship, with
// the currently-live ads AND the
// queued / awaiting-payment ones staged together — so staff judge a
// queued creative against the board it would actually join, not in
// isolation. Leaderboard staging follows the product rule that a new
// bid must take #1: a queued creative previews at rank 1 holding the
// current minimum target, with the live board pushed down one rank
// beneath it. Flipper shows the live strip plus queued cards against
// the 8-slot cap; rails render the fixed L1–R4 slot grid (the profile
// panel lists the same eight top to bottom, 1024px+) with queued ads
// beneath, tagged with their requested slot. Buyer-controlled
// fields are untrusted: text renders as plain text and nothing here
// links to link_url — it only feeds the company-name host fallback.
// Read-only by design; every action stays on the review rows.

import type { ReactNode } from 'react'
import { AdminChip, type AdminChipTone } from './AdminChip'
import { AdminEmpty } from './AdminEmpty'
import { BillboardCard } from '@/components/billboard/BillboardCard'
import { BillboardPreviewStage } from '@/components/billboard/BillboardPreviewStage'
import {
  BILLBOARD_MAX_LIVE,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'
import {
  formatSponsorUsd,
  leaderboardMinTargetCents as nextLeaderboardMinTargetCents
} from '@/lib/leaderboardSponsor'

/** Structural subset of the admin billboard list rows (the page's
 *  AdRow, mirroring GET /api/admin/billboard) — the page passes its
 *  rows straight in. */
export interface SponsorshipBoardPreviewAd {
  id: number
  /** Title line of the sub-banner; null falls back to the link host. */
  company_name: string | null
  text: string
  /** Untrusted buyer destination — used ONLY for the host fallback,
   *  never rendered as a link. */
  link_url: string
  logo_url: string | null
  /** #rrggbb extracted server-side; null = neutral strip. */
  accent_color: string | null
  placement: BillboardPlacement
  /** Slot a live rail ad occupies; null until activation. */
  rail_slot: RailSlot | null
  /** The buyer's slot wish — a preference, never a hold. */
  requested_rail_slot: RailSlot | null
  status: BillboardStatus
  clicks: number
  /** Owner avatar backs the logo fallback, like the public surfaces. */
  owner: { avatar: string | null } | null
  /** Live board standing for leaderboard creatives; null off-board. */
  leaderboard: { rank: number; activeCents: number } | null
}

export interface SponsorshipBoardPreviewProps {
  ads: {
    /** Review queue (PENDING / CHANGES_REQUESTED). */
    queue: SponsorshipBoardPreviewAd[]
    /** Approved, payment not yet closed (leaderboard: bidding open). */
    awaiting: SponsorshipBoardPreviewAd[]
    /** On the boards right now. */
    live: SponsorshipBoardPreviewAd[]
  }
  /** Current total a challenger must reach to take #1 — the server's
   *  figure, same as the page's leaderboardMinTargetCents field. */
  leaderboardMinTargetCents: number
}

/** Which non-live bucket a staged ad came from. Both preview as
 *  prospective tenants; the chip tells staff which gate the ad is
 *  still behind (review vs payment). */
type StagedOrigin = 'queue' | 'awaiting'

interface StagedAd {
  ad: SponsorshipBoardPreviewAd
  origin: StagedOrigin
}

function originChipMeta(origin: StagedOrigin): { label: string; tone: AdminChipTone } {
  switch (origin) {
    case 'queue':
      return { label: 'QUEUED', tone: 'warn' }
    case 'awaiting':
      return { label: 'AWAITING', tone: 'info' }
    default: {
      const exhaustive: never = origin
      return exhaustive
    }
  }
}

/** LIVE for board tenants, QUEUED / AWAITING for staged ones. */
function StatusMarker({ origin }: { origin: StagedOrigin | null }) {
  if (origin === null) return <AdminChip tone="good">LIVE</AdminChip>
  const meta = originChipMeta(origin)
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>
}

/** Title fallback for rows predating company_name: the link's host,
 *  www-stripped, mirroring the queue page and the public feed's
 *  linkHost. Guarded — a malformed stored URL just drops the title. */
function hostOfLink(linkUrl: string): string | null {
  try {
    return new URL(linkUrl).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The status chip + ad id line above every staged creative. */
function MarkerRow({
  ad,
  origin,
  children
}: {
  ad: SponsorshipBoardPreviewAd
  origin: StagedOrigin | null
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
      <StatusMarker origin={origin} />
      {children}
      <span className="font-data text-[12px] text-[color:var(--st-text-faint)]">#{ad.id}</span>
    </div>
  )
}

/** Bordered sub-panel per placement — sized to nest inside whatever
 *  section the review tab mounts this component in. */
function PlacementPanel({
  title,
  meta,
  children
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--st-border)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)] px-4 py-2">
        <h3 className="font-data text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-muted)]">
          {title}
        </h3>
        {meta && <div className="flex flex-wrap items-center gap-3">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

/** A placement with nothing live and nothing staged collapses to one
 *  quiet line instead of an empty board mock. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-3 text-[12.5px] leading-5 text-[color:var(--st-text-muted)]">
      {children}
    </p>
  )
}

/** Quiet occupancy meter, mirroring the sponsorship page's — the live
 *  count is the one place the brand accent appears here. */
function OccupancyMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-muted)]">
        {label} {used}/{max}
      </span>
      <span
        aria-hidden
        className="h-1 w-12 overflow-hidden rounded-full bg-[color:var(--st-border)]"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

/** The sponsor board in rank order with queued creatives slotted at
 *  the top. A new bid must take #1 by product rule, so each staged
 *  creative previews at rank 1 holding the current minimum target
 *  (and showing the correctly incremented next OUTBID target), while
 *  the live entries render pushed down one rank beneath. */
function LeaderboardPanel({
  live,
  staged,
  minTargetCents
}: {
  live: SponsorshipBoardPreviewAd[]
  staged: StagedAd[]
  minTargetCents: number
}) {
  if (live.length === 0 && staged.length === 0) {
    return (
      <PlacementPanel title="Leaderboard sponsor board">
        <EmptyNote>No leaderboard creatives live or queued.</EmptyNote>
      </PlacementPanel>
    )
  }

  const ordered = [...live].sort(
    (a, b) =>
      (a.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
  )
  const shift = staged.length > 0 ? 1 : 0

  return (
    <PlacementPanel
      title="Leaderboard sponsor board"
      meta={
        <span className="font-data text-[11px] tabular-nums text-[color:var(--st-text-faint)]">
          takes #1 at {formatSponsorUsd(minTargetCents)}
        </span>
      }
    >
      <div className="space-y-4 p-3 sm:p-4">
        {shift > 0 && (
          <p className="text-[12px] leading-5 text-[color:var(--st-text-faint)]">
            A new bid must take #1 — queued creatives preview on top at the current minimum
            target, with the live board pushed down one rank beneath them.
          </p>
        )}
        {staged.map(({ ad, origin }) => (
          <div key={`staged-${ad.id}`} className="space-y-1.5">
            <MarkerRow ad={ad} origin={origin}>
              <AdminChip tone="neutral">PREVIEWS AT #1</AdminChip>
            </MarkerRow>
            <BillboardPreviewStage
              density="compact"
              title={ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'}
              text={ad.text}
              logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
              accentColor={ad.accent_color ?? null}
              placement="leaderboard"
              slot={null}
              leaderboardPreview={{
                rank: 1,
                clicks: ad.clicks,
                activeCents: minTargetCents,
                minTargetCents: nextLeaderboardMinTargetCents(minTargetCents)
              }}
            />
          </div>
        ))}
        {ordered.map((ad) => (
          <div key={`live-${ad.id}`} className="space-y-1.5">
            <MarkerRow ad={ad} origin={null} />
            <BillboardPreviewStage
              density="compact"
              title={ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'}
              text={ad.text}
              logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
              accentColor={ad.accent_color ?? null}
              placement="leaderboard"
              slot={null}
              leaderboardPreview={
                // A live creative with no decorated standing (degraded
                // board read) previews like the page's challenger case
                // rather than inventing a rank.
                ad.leaderboard
                  ? {
                      rank: ad.leaderboard.rank + shift,
                      clicks: ad.clicks,
                      activeCents: ad.leaderboard.activeCents,
                      minTargetCents: minTargetCents
                    }
                  : {
                      rank: 1,
                      clicks: ad.clicks,
                      activeCents: minTargetCents,
                      minTargetCents: nextLeaderboardMinTargetCents(minTargetCents)
                    }
              }
            />
          </div>
        ))}
      </div>
    </PlacementPanel>
  )
}

/** The flipper strip: live ads in the exact lg shape they air in, then
 *  queued ones appended with their gate chip, metered against the
 *  concurrent-live cap. */
function FlipperPanel({
  live,
  staged
}: {
  live: SponsorshipBoardPreviewAd[]
  staged: StagedAd[]
}) {
  if (live.length === 0 && staged.length === 0) {
    return (
      <PlacementPanel title="Dashboard flipper">
        <EmptyNote>No flipper ads live or queued.</EmptyNote>
      </PlacementPanel>
    )
  }

  return (
    <PlacementPanel
      title="Dashboard flipper"
      meta={<OccupancyMeter label="Live" used={live.length} max={BILLBOARD_MAX_LIVE} />}
    >
      <div className="grid gap-3 p-3 sm:p-4 xl:grid-cols-2">
        {live.map((ad) => (
          <FlipperItem key={`live-${ad.id}`} ad={ad} origin={null} />
        ))}
        {staged.map(({ ad, origin }) => (
          <FlipperItem key={`staged-${ad.id}`} ad={ad} origin={origin} />
        ))}
      </div>
    </PlacementPanel>
  )
}

function FlipperItem({
  ad,
  origin
}: {
  ad: SponsorshipBoardPreviewAd
  origin: StagedOrigin | null
}) {
  return (
    <div className="space-y-1.5">
      <MarkerRow ad={ad} origin={origin} />
      <BillboardCard
        text={ad.text}
        title={ad.company_name ?? hostOfLink(ad.link_url)}
        logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
        accentColor={ad.accent_color ?? null}
        size="lg"
      />
    </div>
  )
}

/** The fixed L1–R4 rail grid: every slot renders its live occupant in
 *  the rail card shape or an open-slot placeholder with the slot's
 *  price (the profile's TRANSMISSIONS panel shows the same eight as
 *  compact rows); queued/awaiting rail ads sit beneath, tagged with
 *  the slot they asked for (a preference, never a hold). */
function RailPanel({
  live,
  staged
}: {
  live: SponsorshipBoardPreviewAd[]
  staged: StagedAd[]
}) {
  const bySlot = new Map<RailSlot, SponsorshipBoardPreviewAd>()
  for (const ad of live) {
    if (ad.rail_slot) bySlot.set(ad.rail_slot, ad)
  }

  if (bySlot.size === 0 && staged.length === 0) {
    return (
      <PlacementPanel title="Profile transmissions panel">
        <EmptyNote>No transmissions panel ads live or queued.</EmptyNote>
      </PlacementPanel>
    )
  }

  return (
    <PlacementPanel
      title="Profile transmissions panel"
      meta={
        <span className="font-data text-[11px] font-medium tabular-nums text-[color:var(--st-text-muted)]">
          Slots {bySlot.size}/{RAIL_SLOTS.length}
        </span>
      }
    >
      <div className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-wrap gap-3">
          {RAIL_SLOTS.map((slot) => {
            const ad = bySlot.get(slot)
            return (
              <div key={slot} className="w-52 space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-data text-[11px] font-medium text-[color:var(--st-text-muted)]">
                    {slot}
                  </span>
                  <span className="font-data text-[11px] tabular-nums text-[color:var(--st-text-faint)]">
                    ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/wk
                  </span>
                </div>
                {ad ? (
                  <BillboardCard
                    text={ad.text}
                    title={ad.company_name ?? hostOfLink(ad.link_url)}
                    logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
                    accentColor={ad.accent_color ?? null}
                    size="rail"
                  />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-[color:var(--st-border)] bg-[color:var(--st-panel-hover)]">
                    <span className="font-data text-[10px] font-medium uppercase tracking-[0.3em] text-[color:var(--st-text-faint)]">
                      Open
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {staged.length > 0 && (
          <div className="space-y-2 border-t border-[color:var(--st-border)] pt-3">
            <p className="font-data text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--st-text-faint)]">
              Queued for a transmissions slot
            </p>
            <div className="flex flex-wrap gap-3">
              {staged.map(({ ad, origin }) => (
                <div key={ad.id} className="w-52 space-y-1.5">
                  <MarkerRow ad={ad} origin={origin}>
                    {ad.requested_rail_slot && (
                      <AdminChip tone="warn">
                        WANTS {ad.requested_rail_slot} · $
                        {RAIL_SLOT_PRICE_CENTS[ad.requested_rail_slot] / 100}/WK
                      </AdminChip>
                    )}
                  </MarkerRow>
                  <BillboardCard
                    text={ad.text}
                    title={ad.company_name ?? hostOfLink(ad.link_url)}
                    logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
                    accentColor={ad.accent_color ?? null}
                    size="rail"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PlacementPanel>
  )
}

export function SponsorshipBoardPreview({
  ads,
  leaderboardMinTargetCents: minTargetCents
}: SponsorshipBoardPreviewProps) {
  const staged: StagedAd[] = [
    ...ads.queue.map((ad) => ({ ad, origin: 'queue' as const })),
    ...ads.awaiting.map((ad) => ({ ad, origin: 'awaiting' as const }))
  ]
  const stagedFor = (placement: BillboardPlacement) =>
    staged.filter(({ ad }) => ad.placement === placement)
  const liveFor = (placement: BillboardPlacement) =>
    ads.live.filter((ad) => ad.placement === placement)

  if (ads.queue.length + ads.awaiting.length + ads.live.length === 0) {
    return (
      <AdminEmpty
        title="No ads to preview"
        hint="Live, queued and awaiting-payment ads compose into the board preview once they exist."
      />
    )
  }

  return (
    <div className="space-y-4">
      <LeaderboardPanel
        live={liveFor('leaderboard')}
        staged={stagedFor('leaderboard')}
        minTargetCents={minTargetCents}
      />
      <FlipperPanel live={liveFor('flipper')} staged={stagedFor('flipper')} />
      <RailPanel live={liveFor('rail')} staged={stagedFor('rail')} />
    </div>
  )
}
