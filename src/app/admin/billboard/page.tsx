'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell, formatDate, type StaffMe } from '@/components/admin/AdminShell'
import { ReasonDialog } from '@/components/admin/ReasonDialog'
import { BillboardCard } from '@/components/billboard/BillboardCard'
import {
  BILLBOARD_DURATION_DAYS,
  BILLBOARD_MAX_LIVE,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type BillboardStatus,
  type RailSlot
} from '@/lib/billboard'

// Billboard queue: review paid ad submissions with an exact-render
// preview (the same BillboardCard the public surfaces ship), send the
// Polar payment link manually after approving, then mark paid + go
// live. Two products share the queue: flipper ads (capped at 8
// concurrent) and profile-rail ads (one live ad per slot; activation
// picks a free slot from a picker whose occupancy derives client-side
// from the live bucket's rail_slot values — the server re-checks and
// answers 409 if the slot filled meanwhile). Expired ads surface in
// RECENT_DECISIONS with the same activate controls relabelled as a
// renewal — payment is collected manually again and the activate
// route stamps a fresh window, keeping paid_at. Buyer-controlled fields
// (text, link_url, logo_url) are untrusted: text renders as plain text
// and link_url is shown verbatim for inspection, never as a clickable
// link.

interface AdOwner {
  userId: number
  username: string | null
  display_name: string
  avatar: string | null
}

interface AdRow {
  id: number
  owner_user_id: number | null
  /** Title line of the sub-banner; null on rows predating the field. */
  company_name: string | null
  text: string
  link_url: string
  logo_url: string | null
  /** #rrggbb extracted from the logo server-side; null = neutral strip. */
  accent_color: string | null
  /** Which product this card buys — the flipper strip or a profile rail. */
  placement: BillboardPlacement
  /** Rail slot code (L1-R4), stamped at activation; null until then and
   *  always null on flipper ads. */
  rail_slot: RailSlot | null
  status: BillboardStatus
  review_note: string | null
  reviewed_at: string | null
  paid_at: string | null
  starts_at: string | null
  ends_at: string | null
  clicks: number
  created_at: string
  updated_at: string
  owner: AdOwner | null
}

interface BillboardData {
  queue: AdRow[]
  awaiting: AdRow[]
  live: AdRow[]
  recent: AdRow[]
  liveCount: number
  maxLive: number
}

type DialogState =
  | { kind: 'reject'; ad: AdRow }
  | { kind: 'request_changes'; ad: AdRow }
  | { kind: 'archive'; ad: AdRow }

const chipCls = 'rounded border px-2 py-0.5 text-[10px] tracking-[0.2em]'
const sectionCls = 'rounded-md border border-white/10 bg-zinc-950/80 p-5 space-y-4'
const headingCls = 'text-[10px] tracking-[0.25em] text-zinc-500'

function adChip(ad: AdRow, expired: boolean): { label: string; className: string } {
  if (expired) return { label: 'EXPIRED', className: 'text-zinc-400 border-zinc-500/30' }
  switch (ad.status) {
    case 'PENDING':
      return { label: 'PENDING', className: 'text-amber-300 border-amber-400/30' }
    case 'CHANGES_REQUESTED':
      return { label: 'CHANGES REQUESTED', className: 'text-sky-300 border-sky-400/30' }
    case 'APPROVED':
      return { label: 'APPROVED', className: 'text-emerald-400 border-emerald-500/30' }
    case 'REJECTED':
      return { label: 'REJECTED', className: 'text-red-400 border-red-500/30' }
    case 'ARCHIVED':
      return { label: 'ARCHIVED', className: 'text-zinc-400 border-zinc-500/30' }
    default: {
      const exhaustive: never = ad.status
      return exhaustive
    }
  }
}

/** FLIPPER / RAIL placement badge; a rail ad with an assigned slot
 *  carries its code (RAIL · L2) so the live bucket reads at a glance. */
function PlacementChip({ ad }: { ad: AdRow }) {
  const label =
    ad.placement === 'rail' ? (ad.rail_slot ? `RAIL · ${ad.rail_slot}` : 'RAIL') : 'FLIPPER'
  return <span className={`${chipCls} border-zinc-600/40 text-zinc-300`}>{label}</span>
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

function daysRemaining(endsAt: string | null): number {
  if (!endsAt) return 0
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.ceil(ms / 86_400_000)
}

function OwnerLine({ ad }: { ad: AdRow }) {
  if (!ad.owner) {
    return (
      <span className={`${chipCls} border-zinc-600/40 text-zinc-400`}>
        EXTERNAL SPONSOR
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      {ad.owner.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.owner.avatar}
          alt={ad.owner.display_name}
          className="h-5 w-5 rounded-full border border-zinc-800 object-cover"
        />
      ) : (
        <span className="h-5 w-5 rounded-full border border-zinc-800 bg-zinc-900" />
      )}
      <Link
        href={`/admin/users/${ad.owner.userId}`}
        className="text-zinc-200 hover:underline"
      >
        @{ad.owner.username ?? ad.owner.userId}
      </Link>
      {ad.owner.username && (
        <Link
          href={`/u/${encodeURIComponent(ad.owner.username)}`}
          className="text-[10px] tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-200"
        >
          PUBLIC →
        </Link>
      )}
    </span>
  )
}

/** Exact-render preview — in the placement's real shape — plus the
 *  untrusted destination shown as plain text. */
function AdPreview({ ad }: { ad: AdRow }) {
  return (
    <div className="space-y-2">
      <BillboardCard
        text={ad.text}
        title={ad.company_name ?? hostOfLink(ad.link_url)}
        logoUrl={ad.logo_url ?? ad.owner?.avatar ?? null}
        accentColor={ad.accent_color ?? null}
        size={ad.placement === 'rail' ? 'rail' : 'lg'}
      />
      <div className="text-xs text-zinc-500">
        <span className="text-[9px] tracking-[0.3em] text-zinc-600">LINKS TO </span>
        <span className="break-all text-zinc-400">{ad.link_url}</span>
      </div>
    </div>
  )
}

const actionBtn = (tone: 'green' | 'red' | 'sky' | 'zinc') => {
  const tones = {
    green: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/40',
    red: 'border-red-500/40 text-red-300 hover:bg-red-950/40',
    sky: 'border-sky-500/40 text-sky-300 hover:bg-sky-950/40',
    zinc: 'border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
  } as const
  return `rounded-md border px-3 py-1.5 text-[10px] tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`
}

const railFullMsg = `All ${RAIL_SLOTS.length} rail slots are occupied — archive one or wait for a window to end.`

/** The controls that put a paid ad on the board: rail ads get a slot
 *  picker (occupied slots disabled, defaulting to the first free one)
 *  plus the activate button, flipper ads just the button, disabled
 *  while the cap is full. Shared by AWAITING_PAYMENT (first
 *  activation) and the expired rows of RECENT_DECISIONS (renewal —
 *  the same route keeps paid_at and stamps a fresh window); only the
 *  button label differs. */
function ActivateControls({
  ad,
  label,
  working,
  pick,
  occupiedSlots,
  firstFreeSlot,
  flipperFull,
  flipperFullMsg,
  onPickSlot,
  onActivate
}: {
  ad: AdRow
  label: string
  working: boolean
  /** This ad's picker choice; undefined until the admin touches it. */
  pick: RailSlot | undefined
  occupiedSlots: Set<RailSlot>
  firstFreeSlot: RailSlot | undefined
  flipperFull: boolean
  flipperFullMsg: string
  onPickSlot: (slot: RailSlot) => void
  onActivate: (ad: AdRow, slot?: RailSlot) => void
}) {
  // The picked slot, falling back to the first free one; a pick that
  // got occupied since (activation, refresh) falls back too rather
  // than aiming at a taken slot.
  const chosenSlot =
    pick !== undefined && !occupiedSlots.has(pick) ? pick : firstFreeSlot
  return ad.placement === 'rail' ? (
    <>
      <label className="flex items-center gap-2 text-[9px] tracking-[0.3em] text-zinc-600">
        SLOT
        <select
          value={chosenSlot ?? ''}
          disabled={working || chosenSlot === undefined}
          onChange={(e) => onPickSlot(e.target.value as RailSlot)}
          className="rounded-md border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-white focus:border-accent/50 focus:outline-none"
        >
          {chosenSlot === undefined && <option value="">ALL TAKEN</option>}
          {RAIL_SLOTS.map((slot) => (
            <option key={slot} value={slot} disabled={occupiedSlots.has(slot)}>
              {slot}
              {occupiedSlots.has(slot) ? ' — TAKEN' : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={working || chosenSlot === undefined}
        title={chosenSlot === undefined ? railFullMsg : undefined}
        onClick={() => chosenSlot && onActivate(ad, chosenSlot)}
        className={actionBtn('green')}
      >
        {working ? 'WORKING…' : label}
      </button>
    </>
  ) : (
    <button
      disabled={working || flipperFull}
      title={flipperFull ? flipperFullMsg : undefined}
      onClick={() => onActivate(ad)}
      className={actionBtn('green')}
    >
      {working ? 'WORKING…' : label}
    </button>
  )
}

function BillboardQueue({ me }: { me: StaffMe }) {
  const [data, setData] = useState<BillboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  /** Per-ad slot choice for rail activations; unset falls back to the
   *  first free slot. */
  const [railSlotPick, setRailSlotPick] = useState<Record<number, RailSlot>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/billboard', { credentials: 'include' })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(payload?.queue)) {
        throw new Error(payload?.error ?? 'Failed to load billboard ads.')
      }
      setData(payload as BillboardData)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Failed to load billboard ads.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** One-click actions (approve / activate) — errors land in the banner. */
  const run = async (ad: AdRow, url: string, body: Record<string, unknown>, onOk: (data: unknown) => string) => {
    if (workingId !== null) return
    setWorkingId(ad.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        // 409 = the board changed under us (a rail slot filled, the
        // flipper cap hit). Reload so the pickers reflect reality, then
        // re-raise the server's message — load() clears the banner.
        if (res.status === 409) {
          const message =
            typeof payload?.error === 'string' ? payload.error : 'Action failed.'
          await load()
          setError(message)
          return
        }
        throw new Error(payload?.error ?? 'Action failed.')
      }
      setNotice(onOk(payload))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setWorkingId(null)
    }
  }

  const approve = (ad: AdRow) =>
    run(
      ad,
      `/api/admin/billboard/${ad.id}/review`,
      { action: 'approve' },
      () => `Ad #${ad.id} approved — send the Polar payment link, then mark paid + go live.`
    )

  /** Flipper ads activate bare; rail ads must name the slot they take. */
  const activate = (ad: AdRow, slot?: RailSlot) =>
    run(
      ad,
      `/api/admin/billboard/${ad.id}/activate`,
      slot ? { action: 'activate', slot } : { action: 'activate' },
      (payload) => {
        const reminder =
          payload && typeof payload === 'object' && 'paymentReminder' in payload
            ? String((payload as { paymentReminder?: unknown }).paymentReminder ?? '')
            : ''
        return `Ad #${ad.id} is live${
          slot ? ` on slot ${slot}` : ''
        } for ${BILLBOARD_DURATION_DAYS} days. ${reminder}`.trim()
      }
    )

  /** Runs inside ReasonDialog: an error string keeps the dialog open. */
  const confirmDialog = async (state: DialogState, reason: string): Promise<string | null> => {
    const isArchive = state.kind === 'archive'
    const url = isArchive
      ? `/api/admin/billboard/${state.ad.id}/activate`
      : `/api/admin/billboard/${state.ad.id}/review`
    const action = isArchive ? 'archive' : state.kind
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      return payload?.error ?? 'Action failed.'
    }
    switch (state.kind) {
      case 'reject':
        setNotice(`Ad #${state.ad.id} rejected — the buyer sees the reason at /billboard.`)
        break
      case 'request_changes':
        setNotice(`Ad #${state.ad.id} sent back to the buyer for changes.`)
        break
      case 'archive':
        setNotice(`Ad #${state.ad.id} archived — its click stats are kept.`)
        break
      default: {
        const exhaustive: never = state
        return exhaustive
      }
    }
    await load()
    return null
  }

  const isOwner = me.role === 'owner'
  // Occupancy derives client-side from the live bucket: flipper fullness
  // against the 8-cap, rail occupancy from the live rail ads' slot codes.
  // The activate route re-checks both and answers 409 on a race.
  const liveList = data?.live ?? []
  const flipperLiveCount = liveList.filter((ad) => ad.placement === 'flipper').length
  const flipperFull = data !== null && flipperLiveCount >= data.maxLive
  const flipperFullMsg = data
    ? `All ${data.maxLive} flipper slots are live — archive one or wait for a window to end.`
    : ''
  const occupiedSlots = new Set<RailSlot>(
    liveList.flatMap((ad) => (ad.placement === 'rail' && ad.rail_slot ? [ad.rail_slot] : []))
  )
  const firstFreeSlot = RAIL_SLOTS.find((slot) => !occupiedSlots.has(slot))

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billboard</h1>
        <p className="text-sm text-gray-400">
          Paid ad slots, two placements — the flipper train on the dashboard + leaderboard ($
          {BILLBOARD_PRICE_CENTS / 100}/wk, max {BILLBOARD_MAX_LIVE} live) and the always-on
          profile rails (${BILLBOARD_RAIL_PRICE_CENTS / 100}/wk, {RAIL_SLOTS.length} fixed
          slots). Approve the copy here, send the Polar payment link manually, then mark paid +
          go live — rail ads take their slot at activation.
        </p>
      </div>

      {notice && (
        <p className="rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          {notice}
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : !data ? null : (
        <>
          <section className={sectionCls}>
            <h2 className={headingCls}>REVIEW_QUEUE ({data.queue.length})</h2>
            {data.queue.length === 0 ? (
              <p className="text-xs text-zinc-600">Nothing waiting for review.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.queue.map((ad) => {
                  const chip = adChip(ad, false)
                  const working = workingId === ad.id
                  return (
                    <li key={ad.id} className="py-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span className={`${chipCls} ${chip.className}`}>{chip.label}</span>
                        <PlacementChip ad={ad} />
                        <span className="text-zinc-600">#{ad.id}</span>
                        <OwnerLine ad={ad} />
                        <span className="text-zinc-600">
                          submitted {formatDate(ad.created_at)}
                        </span>
                      </div>
                      <AdPreview ad={ad} />
                      {ad.status === 'CHANGES_REQUESTED' && ad.review_note && (
                        <p className="text-xs text-sky-300/80">
                          <span className="text-[9px] tracking-[0.3em] text-zinc-600">
                            SENT BACK{' '}
                          </span>
                          {ad.review_note}
                        </p>
                      )}
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            disabled={working}
                            onClick={() => approve(ad)}
                            className={actionBtn('green')}
                          >
                            {working ? 'WORKING…' : 'APPROVE'}
                          </button>
                          {ad.status === 'PENDING' && (
                            <button
                              disabled={working}
                              onClick={() => setDialog({ kind: 'request_changes', ad })}
                              className={actionBtn('sky')}
                            >
                              REQUEST CHANGES
                            </button>
                          )}
                          <button
                            disabled={working}
                            onClick={() => setDialog({ kind: 'reject', ad })}
                            className={actionBtn('red')}
                          >
                            REJECT
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className={sectionCls}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={headingCls}>AWAITING_PAYMENT ({data.awaiting.length})</h2>
              <p className="text-[10px] text-zinc-600">
                The Polar payment link is sent manually — nothing here bills the buyer.
              </p>
            </div>
            {flipperFull &&
              data.awaiting.some((ad) => ad.placement === 'flipper') && (
                <p className="text-xs text-amber-300/80">{flipperFullMsg}</p>
              )}
            {firstFreeSlot === undefined &&
              data.awaiting.some((ad) => ad.placement === 'rail') && (
                <p className="text-xs text-amber-300/80">{railFullMsg}</p>
              )}
            {data.awaiting.length === 0 ? (
              <p className="text-xs text-zinc-600">No approved ads waiting on payment.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.awaiting.map((ad) => {
                  const working = workingId === ad.id
                  return (
                    <li key={ad.id} className="py-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span className={`${chipCls} text-emerald-400 border-emerald-500/30`}>
                          APPROVED
                        </span>
                        <PlacementChip ad={ad} />
                        <span className="text-zinc-600">#{ad.id}</span>
                        <OwnerLine ad={ad} />
                        <span className="text-zinc-600">
                          approved {formatDate(ad.reviewed_at)}
                        </span>
                      </div>
                      <AdPreview ad={ad} />
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          <ActivateControls
                            ad={ad}
                            label="MARK PAID + GO LIVE"
                            working={working}
                            pick={railSlotPick[ad.id]}
                            occupiedSlots={occupiedSlots}
                            firstFreeSlot={firstFreeSlot}
                            flipperFull={flipperFull}
                            flipperFullMsg={flipperFullMsg}
                            onPickSlot={(slot) =>
                              setRailSlotPick((prev) => ({ ...prev, [ad.id]: slot }))
                            }
                            onActivate={activate}
                          />
                          <button
                            disabled={working}
                            onClick={() => setDialog({ kind: 'archive', ad })}
                            className={actionBtn('zinc')}
                          >
                            ARCHIVE
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className={sectionCls}>
            {/* both products' occupancy, derived from the list below */}
            <h2 className={headingCls}>
              LIVE_NOW ({data.live.length}) · FLIPPER {flipperLiveCount}/{data.maxLive} · RAIL{' '}
              {occupiedSlots.size}/{RAIL_SLOTS.length}
            </h2>
            {data.live.length === 0 ? (
              <p className="text-xs text-zinc-600">No ads on the billboard right now.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.live.map((ad) => {
                  const working = workingId === ad.id
                  const days = daysRemaining(ad.ends_at)
                  return (
                    <li key={ad.id} className="py-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span className={`${chipCls} text-emerald-400 border-emerald-500/30`}>
                          LIVE
                        </span>
                        <PlacementChip ad={ad} />
                        <span className="text-zinc-600">#{ad.id}</span>
                        <OwnerLine ad={ad} />
                        <span className="text-zinc-300">
                          {days} day{days === 1 ? '' : 's'} left
                        </span>
                        <span className="text-zinc-600">ends {formatDate(ad.ends_at)}</span>
                        <span className="text-zinc-300">
                          {ad.clicks.toLocaleString('en-US')} click{ad.clicks === 1 ? '' : 's'}
                        </span>
                      </div>
                      <AdPreview ad={ad} />
                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            disabled={working}
                            onClick={() => setDialog({ kind: 'archive', ad })}
                            className={actionBtn('red')}
                          >
                            ARCHIVE
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className={sectionCls}>
            <h2 className={headingCls}>RECENT_DECISIONS ({data.recent.length})</h2>
            {data.recent.length === 0 ? (
              <p className="text-xs text-zinc-600">No past decisions yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.recent.map((ad) => {
                  // APPROVED rows only land here when their window ran
                  // out — those get renew controls below. REJECTED and
                  // ARCHIVED rows stay read-only.
                  const expired = ad.status === 'APPROVED'
                  const chip = adChip(ad, expired)
                  const working = workingId === ad.id
                  return (
                    <li key={ad.id} className="py-3 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        <span className={`${chipCls} ${chip.className}`}>{chip.label}</span>
                        <PlacementChip ad={ad} />
                        <span className="text-zinc-600">#{ad.id}</span>
                        <OwnerLine ad={ad} />
                        <span className="text-zinc-600">{formatDate(ad.updated_at)}</span>
                        {ad.clicks > 0 && (
                          <span className="text-zinc-500">
                            {ad.clicks.toLocaleString('en-US')} click
                            {ad.clicks === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p className="break-words text-sm text-zinc-300">{ad.text}</p>
                      {ad.review_note && (
                        <p className="text-xs text-zinc-500">{ad.review_note}</p>
                      )}
                      {isOwner && expired && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <ActivateControls
                            ad={ad}
                            label="RENEW — MARK PAID + GO LIVE"
                            working={working}
                            pick={railSlotPick[ad.id]}
                            occupiedSlots={occupiedSlots}
                            firstFreeSlot={firstFreeSlot}
                            flipperFull={flipperFull}
                            flipperFullMsg={flipperFullMsg}
                            onPickSlot={(slot) =>
                              setRailSlotPick((prev) => ({ ...prev, [ad.id]: slot }))
                            }
                            onActivate={activate}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {dialog?.kind === 'reject' && (
        <ReasonDialog
          title={`REJECT AD #${dialog.ad.id}`}
          description="Marks the submission rejected. The reason is stored on the ad, shown to the buyer at /billboard, and logged to the audit trail."
          confirmLabel="REJECT AD"
          danger
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'request_changes' && (
        <ReasonDialog
          title={`REQUEST CHANGES — AD #${dialog.ad.id}`}
          description="Sends the ad back to the buyer with this note. They edit and resubmit at /billboard, which returns it to the review queue."
          confirmLabel="REQUEST CHANGES"
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ReasonDialog
          title={`ARCHIVE AD #${dialog.ad.id}`}
          description="Takes the ad off the billboard immediately. Click stats are kept; the slot is not refunded here — refunds happen manually in Polar if owed."
          confirmLabel="ARCHIVE AD"
          danger
          onConfirm={(reason) => confirmDialog(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

export default function AdminBillboardPage() {
  return <AdminShell section="BILLBOARD">{(me) => <BillboardQueue me={me} />}</AdminShell>
}
