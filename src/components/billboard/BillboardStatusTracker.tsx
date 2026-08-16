'use client'

// The buyer's slot tracker on /billboard — every submission from GET
// /api/billboard/mine as one compact row inside a single hairline panel,
// sorted action-first. A row expands in place to the ad rendered with
// the real BillboardCard on a fixed dark ground (it mirrors the
// always-dark ticker in both themes), the stage-specific story beneath
// it, and — for PENDING / CHANGES_REQUESTED — the shared composer for
// edit / edit-and-resubmit. Admin feedback (review_note) stays the
// loudest element of a redo/reject row because it is the one thing the
// buyer must read.

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BillboardCard } from '@/components/billboard/BillboardCard'
import {
  BillboardSubmitForm,
  type AdFormTarget
} from '@/components/billboard/BillboardSubmitForm'
import { SettingsButton } from '@/components/settings'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_PAYMENT_EMAIL,
  BILLBOARD_PAYMENT_X_HANDLE,
  BILLBOARD_PAYMENT_X_URL,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  RAIL_SLOT_PRICE_CENTS,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'

/** One row of GET /api/billboard/mine — isLive computed server-side. */
export interface MineAd {
  id: number
  status: BillboardStatus
  /** Title line of the sub-banner; null on rows predating the field. */
  company_name: string | null
  text: string
  link_url: string
  logo_url: string | null
  /** #rrggbb extracted from the logo server-side; null = neutral strip. */
  accent_color: string | null
  /** Which product this card buys — the flipper strip or a profile rail. */
  placement: BillboardPlacement
  /** Rail slot code (L1-R4), assigned by the admin at activation; null
   *  until then and always null on flipper ads. */
  rail_slot: RailSlot | null
  /** The slot the buyer asked for at submission — a preference, not a
   *  hold (first confirmed payment wins). Null = any slot; always null
   *  on flipper ads. */
  requested_rail_slot: RailSlot | null
  /** Where the payment instructions are emailed on approval (migration
   *  040); null on rows predating the field. */
  billing_email: string | null
  review_note: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  isLive: boolean
}

const AMBER = '252 211 77'
const ZINC = '161 161 170'

/** The redo amber is the one literal triple that can't stay literal:
 *  amber-300 text is illegible on the light surface, so it flips to
 *  amber-700 via a scoped var. The class strings must stay literal —
 *  Tailwind's JIT can't see dynamically built ones. */
const AMBER_FLIP_CLS = '[--bb-amber:252_211_77] [html.light_&]:[--bb-amber:180_83_9]'

interface ChipMeta {
  label: string
  rgb: string
  /** True only for the redo amber — the dot then reads its color from
   *  the theme-flipping --bb-amber var instead of the raw triple. */
  amber?: boolean
}

/** Lifecycle chip. APPROVED fans out by payment/window state: the admin
 *  stamps paid_at + the 7-day window together at activation, so a bare
 *  APPROVED row is still waiting on the manual X-DM payment step. */
function chipMeta(ad: MineAd, now: Date): ChipMeta {
  switch (ad.status) {
    case 'PENDING':
      return { label: 'In review', rgb: ZINC }
    case 'CHANGES_REQUESTED':
      return { label: 'Redo requested', rgb: AMBER, amber: true }
    case 'APPROVED': {
      if (ad.isLive) return { label: 'Live', rgb: 'var(--lb-up)' }
      if (ad.ends_at && new Date(ad.ends_at).getTime() < now.getTime()) {
        return { label: 'Run complete', rgb: ZINC }
      }
      if (ad.starts_at && new Date(ad.starts_at).getTime() > now.getTime()) {
        return { label: 'Scheduled', rgb: 'var(--lb-gold)' }
      }
      return { label: 'Awaiting payment', rgb: 'var(--lb-gold)' }
    }
    case 'REJECTED':
      return { label: 'Rejected', rgb: 'var(--lb-down)' }
    case 'ARCHIVED':
      return { label: 'Archived', rgb: ZINC }
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
}

/** Title fallback for rows predating company_name: the link's host,
 *  www-stripped, mirroring the public feed's linkHost. Guarded — a
 *  malformed stored URL just drops the title line. */
function hostOfLink(linkUrl: string): string | null {
  try {
    return new URL(linkUrl).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** The dollar ask while payment is pending: the flipper's flat price,
 *  the requested slot's ladder price, or the ladder floor when the
 *  buyer left the slot open. */
function adPriceLabel(ad: MineAd): string {
  if (ad.placement !== 'rail') return `$${BILLBOARD_PRICE_CENTS / 100}/wk`
  if (ad.requested_rail_slot) {
    return `$${RAIL_SLOT_PRICE_CENTS[ad.requested_rail_slot] / 100}/wk`
  }
  return `from $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk`
}

const daysLeft = (endsAt: string, now: Date) =>
  Math.max(0, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / 86_400_000))

/** Sort groups, ascending rank: what needs the buyer's eyes (or money)
 *  first, history last. */
function sortGroup(ad: MineAd, now: Date): number {
  switch (ad.status) {
    case 'CHANGES_REQUESTED':
      return 0
    case 'APPROVED': {
      if (ad.isLive) return 1
      if (ad.ends_at && new Date(ad.ends_at).getTime() < now.getTime()) return 4
      return 3
    }
    case 'PENDING':
      return 2
    case 'REJECTED':
    case 'ARCHIVED':
      return 4
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
}

/** Action-first ordering; newest submission first within a group. */
function sortAds(ads: MineAd[], now: Date): MineAd[] {
  return [...ads].sort((a, b) => {
    const g = sortGroup(a, now) - sortGroup(b, now)
    if (g !== 0) return g
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

type FilterId = 'all' | 'live' | 'review' | 'ended'

/** In review covers the redo loop too — a CHANGES_REQUESTED card is
 *  still the buyer's to fix, not history. */
function matchesFilter(ad: MineAd, filter: FilterId, now: Date): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'live':
      return ad.isLive
    case 'review':
      return ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'
    case 'ended':
      return (
        ad.status === 'REJECTED' ||
        ad.status === 'ARCHIVED' ||
        (ad.status === 'APPROVED' &&
          !ad.isLive &&
          ad.ends_at !== null &&
          new Date(ad.ends_at).getTime() < now.getTime())
      )
    default: {
      const exhaustive: never = filter
      return exhaustive
    }
  }
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'review', label: 'In review' },
  { id: 'ended', label: 'Ended' }
]

/** Compact lifecycle pill: colored dot + 12px label. */
function Chip({ meta }: { meta: ChipMeta }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--st-border)] px-2 py-0.5 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full${meta.amber ? ` ${AMBER_FLIP_CLS}` : ''}`}
        style={{ background: meta.amber ? 'rgb(var(--bb-amber))' : `rgb(${meta.rgb})` }}
      />
      {meta.label}
    </span>
  )
}

/** The admin's written feedback — the loudest element of a redo/reject
 *  row, because answering (or reading) it is the buyer's next move.
 *  `amber` swaps the raw triple for the theme-flipping --bb-amber var
 *  (amber-300 is illegible on the light surface). */
function FeedbackNote({
  note,
  rgb,
  title,
  amber
}: {
  note: string
  rgb: string
  title: string
  amber?: boolean
}) {
  const ink = amber ? 'var(--bb-amber)' : rgb
  return (
    <div
      className={`rounded-lg px-3 py-2.5${amber ? ` ${AMBER_FLIP_CLS}` : ''}`}
      style={{
        border: `1px solid rgb(${ink} / 0.35)`,
        background: `rgb(${ink} / 0.06)`
      }}
    >
      <span className="text-[12px] font-medium" style={{ color: `rgb(${ink})` }}>
        {title}
      </span>
      <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--st-text)]">{note}</p>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[color:var(--st-border)] rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] [box-shadow:var(--st-panel-shadow)]">
      {children}
    </div>
  )
}

function SkeletonRows() {
  return (
    <Panel>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <span className="block h-5 w-20 animate-pulse rounded-full bg-[color:var(--st-panel-hover)]" />
          <span className="block h-4 w-36 animate-pulse rounded bg-[color:var(--st-panel-hover)]" />
          <span className="ml-auto block h-4 w-14 animate-pulse rounded bg-[color:var(--st-panel-hover)]" />
        </div>
      ))}
    </Panel>
  )
}

function AdRow({
  ad,
  fallbackLogoUrl,
  onChanged
}: {
  ad: MineAd
  fallbackLogoUrl: string | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const now = new Date()
  const meta = chipMeta(ad, now)
  const editable = ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'

  const editTarget: AdFormTarget = {
    mode: 'edit',
    adId: ad.id,
    resubmits: ad.status === 'CHANGES_REQUESTED'
  }

  const title = ad.company_name ?? hostOfLink(ad.link_url) ?? 'Untitled'
  // A rail ad wears its assigned slot once the admin stamps one; until
  // then the buyer's request shows as a wish ("wants R1"), never as if
  // the slot were already theirs.
  const placementLabel =
    ad.placement === 'rail'
      ? ad.rail_slot
        ? `Rail · ${ad.rail_slot}`
        : ad.requested_rail_slot
          ? `Rail · wants ${ad.requested_rail_slot}`
          : 'Rail'
      : 'Flipper'
  const regionId = `billboard-ad-${ad.id}`

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-[color:var(--st-panel-hover)]"
      >
        <Chip meta={meta} />
        <span className="min-w-0 truncate text-[15px] font-medium text-[color:var(--st-text)]">
          {title}
        </span>
        <span className="shrink-0 text-[12px] text-[color:var(--st-text-faint)]">
          {placementLabel}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="text-[12px] tabular-nums text-[color:var(--st-text-muted)]">
            {ad.clicks.toLocaleString()} click{ad.clicks === 1 ? '' : 's'}
            {ad.isLive && ad.ends_at
              ? ` · ${daysLeft(ad.ends_at, now)}d left`
              : ` · ${fmtDate(ad.created_at)}`}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 text-[color:var(--st-text-faint)] motion-safe:transition-transform motion-safe:duration-150 ${open ? 'rotate-180' : ''}`}
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </button>

      {open && (
        <div id={regionId} className="space-y-3 px-4 pb-4 pt-1">
          {/* the card itself, in its placement's shape, on a fixed dark
              ground — it mirrors the always-dark ticker in both themes */}
          <div className="flex items-center overflow-hidden rounded-lg border border-[color:var(--st-border)] bg-[#09090b] px-4 py-4">
            <BillboardCard
              text={ad.text}
              title={ad.company_name ?? hostOfLink(ad.link_url)}
              logoUrl={ad.logo_url ?? fallbackLogoUrl}
              accentColor={ad.accent_color ?? null}
              size={ad.placement === 'rail' ? 'rail' : 'lg'}
              className="max-w-full"
            />
          </div>
          <p className="truncate text-[12px] text-[color:var(--st-text-faint)]">
            Links to <span className="text-[color:var(--st-text-muted)]">{ad.link_url}</span>
          </p>

          {ad.status === 'CHANGES_REQUESTED' && ad.review_note && (
            <FeedbackNote note={ad.review_note} rgb={AMBER} title="Admin feedback" amber />
          )}
          {ad.status === 'REJECTED' && (
            <FeedbackNote
              note={ad.review_note ?? 'No reason was recorded.'}
              rgb="var(--lb-down)"
              title="Rejected — why"
            />
          )}

          {ad.status === 'PENDING' && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              In the review queue — a human checks every card. You can still edit it while it
              waits.
            </p>
          )}

          {ad.status === 'APPROVED' && !ad.isLive && !ad.ends_at && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              {/* Email-first: name the buyer's own billing inbox when one
                  is on file; pre-040 ads (no address) get the public
                  billing address instead. X DM stays the backup. */}
              Approved — payment ({adPriceLabel(ad)}) is handled personally over email:{' '}
              {ad.billing_email ? (
                <>
                  the payment instructions go to{' '}
                  <span className="font-medium text-[color:var(--st-text)]">
                    {ad.billing_email}
                  </span>{' '}
                  — reply there to complete it
                </>
              ) : (
                <>
                  email{' '}
                  <a
                    href={`mailto:${BILLBOARD_PAYMENT_EMAIL}`}
                    className="font-medium text-[color:var(--st-text)] transition-colors hover:text-[color:var(--st-text-muted)]"
                  >
                    {BILLBOARD_PAYMENT_EMAIL}
                  </a>{' '}
                  to arrange it
                </>
              )}
              , or DM{' '}
              <a
                href={BILLBOARD_PAYMENT_X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[color:var(--st-text)] transition-colors hover:text-[color:var(--st-text-muted)]"
              >
                @{BILLBOARD_PAYMENT_X_HANDLE}
              </a>{' '}
              on X as backup. Once confirmed, your ad is activated by hand — usually
              within minutes, at most a few hours — and your {BILLBOARD_DURATION_DAYS}-day run
              starts the moment {`it's`} live. Slots go to the first confirmed payment; if
              yours fills first, pick another open slot over email or DM.
            </p>
          )}

          {ad.status === 'APPROVED' && ad.starts_at && ad.ends_at && (
            <p className="text-[12px] text-[color:var(--st-text-muted)]">
              <span className="tabular-nums">
                {fmtDate(ad.starts_at)} → {fmtDate(ad.ends_at)}
              </span>
              {ad.placement === 'rail' && ad.rail_slot && <span> · Slot {ad.rail_slot}</span>}
              {ad.isLive && <span> · {daysLeft(ad.ends_at, now)}d left</span>}
              <span className="tabular-nums">
                {' '}
                · {ad.clicks.toLocaleString()} click{ad.clicks === 1 ? '' : 's'}
              </span>
            </p>
          )}

          {ad.status === 'ARCHIVED' && (
            <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
              Retired by an admin. Its click stats are kept
              {ad.clicks > 0 ? ` — ${ad.clicks.toLocaleString()} total.` : '.'}
            </p>
          )}

          {editable && !editing && (
            <div>
              <SettingsButton variant="ghost" onClick={() => setEditing(true)}>
                {ad.status === 'CHANGES_REQUESTED' ? 'Edit & resubmit' : 'Edit'}
              </SettingsButton>
            </div>
          )}

          {editing && (
            <div className="border-t border-[color:var(--st-border)] pt-4">
              <BillboardSubmitForm
                target={editTarget}
                initial={{
                  company_name: ad.company_name ?? '',
                  text: ad.text,
                  link_url: ad.link_url,
                  logo_url: ad.logo_url ?? '',
                  placement: ad.placement,
                  requested_rail_slot: ad.requested_rail_slot,
                  billing_email: ad.billing_email ?? ''
                }}
                fallbackLogoUrl={fallbackLogoUrl}
                signedIn={true}
                onSaved={() => {
                  setEditing(false)
                  onChanged()
                }}
                onConflict={onChanged}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BillboardStatusTracker({
  ads,
  loading,
  error,
  signedIn,
  fallbackLogoUrl,
  onChanged,
  onBrowseSlots
}: {
  ads: MineAd[]
  loading: boolean
  error: string | null
  signedIn: boolean | null
  fallbackLogoUrl: string | null
  onChanged: () => void
  /** Hands the empty state's Browse slots button to the parent, which
   *  switches /billboard to the buy tab. Omitting it drops the button. */
  onBrowseSlots?: () => void
}) {
  const [filter, setFilter] = useState<FilterId>('all')
  const visible = useMemo(() => {
    const now = new Date()
    return sortAds(ads, now).filter((ad) => matchesFilter(ad, filter, now))
  }, [ads, filter])

  if (signedIn === false) {
    return (
      <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-5 py-6 text-center [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
          Your submissions and their review status show up here.
        </p>
        <Link
          href="/login"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-[color:var(--st-text)] transition-colors hover:text-[color:var(--st-text-muted)] md:min-h-0"
        >
          Sign in to track your slots <span aria-hidden>→</span>
        </Link>
      </div>
    )
  }

  if (loading) {
    return <SkeletonRows />
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-5 py-4 [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13px] leading-relaxed text-[color:var(--st-danger)]">{error}</p>
        <SettingsButton variant="ghost" onClick={onChanged}>
          Retry
        </SettingsButton>
      </div>
    )
  }

  if (ads.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--st-border)] bg-[color:var(--st-panel)] px-5 py-6 text-center [box-shadow:var(--st-panel-shadow)]">
        <p className="text-[13px] leading-relaxed text-[color:var(--st-text-muted)]">
          No submissions yet — pitch your card and it lands here for tracking.
        </p>
        {onBrowseSlots && (
          <div className="mt-3">
            <SettingsButton variant="ghost" onClick={onBrowseSlots}>
              Browse slots
            </SettingsButton>
          </div>
        )}
      </div>
    )
  }

  const liveCount = ads.filter((ad) => ad.isLive).length
  const reviewCount = ads.filter(
    (ad) => ad.status === 'PENDING' || ad.status === 'CHANGES_REQUESTED'
  ).length
  const totalClicks = ads.reduce((sum, ad) => sum + ad.clicks, 0)
  const summaryParts: string[] = []
  if (liveCount > 0) summaryParts.push(`${liveCount} live`)
  if (reviewCount > 0) summaryParts.push(`${reviewCount} in review`)
  summaryParts.push(`${totalClicks.toLocaleString()} total clicks`)

  return (
    <div>
      {ads.length > 1 && (
        <p className="mb-3 text-[13px] tabular-nums text-[color:var(--st-text-muted)]">
          {summaryParts.join(' · ')}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`inline-flex min-h-11 items-center rounded-full border px-2.5 py-1 text-[12px] leading-4 transition-colors md:min-h-0 ${
              filter === f.id
                ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)] text-[color:var(--st-text)]'
                : 'border-[color:var(--st-border)] text-[color:var(--st-text-muted)] hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Panel>
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[color:var(--st-text-muted)]">
            Nothing in this view.
          </p>
        ) : (
          visible.map((ad) => (
            <AdRow key={ad.id} ad={ad} fallbackLogoUrl={fallbackLogoUrl} onChanged={onChanged} />
          ))
        )}
      </Panel>
    </div>
  )
}
