'use client'

// The buyer's ad composer — used twice on /billboard: as the main
// submission form (POST /api/billboard/submit) and, embedded in the
// status tracker, as the edit / edit-and-resubmit form for a PENDING or
// CHANGES_REQUESTED ad (PATCH /api/billboard/[id]). The placement
// picker chooses which product the card buys — the rotating flipper
// strip or an always-on profile rail — and ships as `placement` on both
// create and edit. Picking the rail reveals a slot grid mirroring the
// real rail geometry, fed by /api/billboard/slots (fetched here, not by
// a parent, because the form mounts in both contexts): the buyer may
// request a specific slot, shipped as `requested_rail_slot` on create
// and edit. Taken slots stay selectable — a request is a preference
// resolved first-confirmed-payment-first, never a hold — and the rail
// placement card's price live-tracks the selected slot's ladder tier.
// The live preview is the real BillboardCard in the
// chosen placement's shape (lg strip for the flipper, the vertical rail
// card for a rail), fed the form values as typed, with the caller's
// avatar standing in while the logo URL is blank — so the composer
// always shows exactly the card that airs. The accent tint on the
// preview is best-effort client-side (canvas-sampled from the logo);
// the shipped color is extracted server-side at submit.
//
// The server owns real validation (required company name, code-point
// caps, SSRF-safe URL checks, the one-in-flight rule); this form only
// keeps honest people honest and renders the API's 400/409 answers
// inline. A create-mode 409 (a submission is already in review) is
// expected steady-state, so it gets a calm amber notice pointing at the
// tracker instead of an error.
//
// Skin: the settings design system. The --st-* tokens and the st-input
// chrome only resolve under an ancestor .settings-scope, which the
// /billboard page shell provides.
//
// Layout: on lg the form splits into a fields column and a sticky
// 300px preview column (300 over the plan's 320 because the tracker
// embeds the same form inside max-w-3xl, where ~700px is all there
// is). The preview leads the DOM so it stacks above the fields on
// mobile — the card is the product hook.

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { BillboardCard } from '@/components/billboard/BillboardCard'
import { SettingsButton } from '@/components/settings'
import { toast } from '@/components/Toaster'
import {
  BILLBOARD_COMPANY_MAX,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  BILLBOARD_TEXT_MAX,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type RailSlot,
  type SlotBoard
} from '@/lib/billboard'

export interface AdFormValues {
  company_name: string
  text: string
  link_url: string
  logo_url: string
  placement: BillboardPlacement
  /** Rail-slot preference; null = any slot (and always null for the
   *  flipper). Edit mode initializes it from the ad being edited. */
  requested_rail_slot: RailSlot | null
  /** Where the payment instructions are emailed on approval (migration
   *  040) — required by the server; never shown publicly. */
  billing_email: string
}

/** Create posts a new submission; edit rewrites one in place. A redo
 *  answer (`resubmits`) relabels the button and success toast, because
 *  saving it moves the ad back into the review queue. */
export type AdFormTarget =
  | { mode: 'create' }
  | { mode: 'edit'; adId: number; resubmits: boolean }

// Code-point helpers so the counter and cap agree with the table's
// char_length CHECK — .length would over-count astral characters.
const cpLength = (v: string) => [...v].length
const cpSlice = (v: string, max: number) => [...v].slice(0, max).join('')

/** Preview-only mirror of the server's linkHost fallback: hostname of
 *  the link field, www-stripped — scheme-tolerant because the buyer is
 *  mid-typing. null (blank / won't parse) falls through to the neutral
 *  placeholder on the preview's title line. */
function hostFromLink(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Preview-only dominant color: draw the logo onto a tiny canvas and
 *  average the opaque pixels, clamped the same direction the server
 *  clamps so the tint stays legible on the dark strip. Best effort by
 *  design — a host without CORS headers fails the crossOrigin load (or
 *  taints the canvas and getImageData throws), dead URLs fail decode(),
 *  and all failures resolve null: the neutral zinc strip. */
async function extractPreviewAccent(url: string): Promise<string | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await img.decode()
    const size = 16
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      // Skip transparent padding — logo marks often sit on empty ground.
      if (data[i + 3] < 128) continue
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count += 1
    }
    if (count === 0) return null
    return clampAccent(r / count / 255, g / count / 255, b / count / 255)
  } catch {
    return null
  }
}

/** RGB (0..1) -> clamped #rrggbb, or null when the average is near-gray
 *  (its hue is noise, so tinting by it would invent a color). */
function clampAccent(r: number, g: number, b: number): string | null {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 0.03) return null
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  // Legibility clamp — mirrors the spirit of the server-side extractor.
  return hslToHex(h, Math.min(0.85, Math.max(0.45, s)), Math.min(0.62, Math.max(0.45, l)))
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return `#${rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The two products a card can buy — prices derive from the shared
 *  constants so a repricing lands here automatically. The rail card
 *  carries the ladder floor ("from $199"); the render overrides it with
 *  the selected slot's exact price once one is picked. */
const PLACEMENTS: {
  value: BillboardPlacement
  label: string
  price: string
  blurb: string
}[] = [
  {
    value: 'flipper',
    label: 'Billboard flipper',
    price: `$${BILLBOARD_PRICE_CENTS / 100}`,
    blurb: 'Rotates under the nav on the dashboard + leaderboard.'
  },
  {
    value: 'rail',
    label: 'Profile rail',
    price: `from $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}`,
    blurb: 'Always-on card beside every profile page.'
  }
]

const fieldInputCls =
  'st-input block w-full rounded-lg px-3 py-2.5 text-[16px] leading-6 md:py-1.5 md:text-[14px]'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** The 409 amber flips per theme via a scoped var: amber-300 on dark,
 *  amber-700 on light — amber-300 text is illegible on the light
 *  surface. Literal class strings (Tailwind's JIT can't see dynamic
 *  ones). */
const AMBER_FLIP_CLS = '[--bb-amber:252_211_77] [html.light_&]:[--bb-amber:180_83_9]'

/** Settings-style field chrome: 13px medium label with a right-aligned
 *  12.5px hint/counter slot. Local instead of the settings TextField
 *  because the counters must count code points (cpLength), not UTF-16
 *  units — TextField's counter uses value.length, which disagrees with
 *  the table's char_length CHECK on astral characters. */
function FormField({
  id,
  label,
  aside,
  children
}: {
  id: string
  label: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
        >
          {label}
        </label>
        {aside}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

export function BillboardSubmitForm({
  target,
  initial,
  fallbackLogoUrl,
  signedIn,
  onSaved,
  onConflict,
  onCancel
}: {
  target: AdFormTarget
  initial?: AdFormValues
  /** The user's avatar — stands in on the preview while logo_url is blank,
   *  mirroring how the ticker renders ads without a logo. */
  fallbackLogoUrl: string | null
  /** null = still resolving; only a definitive false swaps the submit
   *  button for a sign-in link. */
  signedIn: boolean | null
  onSaved: () => void
  /** Fired on 409 so the caller can refresh the tracker — either the
   *  in-flight submission (create) or a concurrent admin decision (edit). */
  onConflict?: () => void
  onCancel?: () => void
}) {
  const [companyName, setCompanyName] = useState(initial?.company_name ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '')
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url ?? '')
  const [billingEmail, setBillingEmail] = useState(initial?.billing_email ?? '')
  const [placement, setPlacement] = useState<BillboardPlacement>(initial?.placement ?? 'flipper')
  const [requestedSlot, setRequestedSlot] = useState<RailSlot | null>(
    initial?.requested_rail_slot ?? null
  )
  /** Availability for the slot picker; null (loading or failed) still
   *  renders every slot — codes and ladder prices are static — it just
   *  withholds the open / taken-until state line. */
  const [board, setBoard] = useState<SlotBoard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [previewAccent, setPreviewAccent] = useState<string | null>(null)

  const uid = useId()
  const companyId = `${uid}-company`
  const textId = `${uid}-text`
  const linkId = `${uid}-link`
  const logoId = `${uid}-logo`
  const billingId = `${uid}-billing`
  const placementLabelId = `${uid}-placement`
  const slotLabelId = `${uid}-slot`

  // The picker's availability, fetched by the form itself: it mounts in
  // two contexts (landing create, tracker edit) and only it knows when
  // the rail — and therefore the picker — is in play. Best-effort, same
  // guard as the landing's board fetch.
  useEffect(() => {
    let cancelled = false
    fetch('/api/billboard/slots')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SlotBoard | null) => {
        if (cancelled) return
        if (data && data.flipper && Array.isArray(data.rails)) setBoard(data)
      })
      .catch(() => {
        // The picker works without availability — every slot stays
        // selectable either way.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Roving tabindex for the placement radiogroup, mirroring
  // SegmentedControl: Tab lands on the checked card, arrows move and
  // select (wrapping), Home/End jump.
  const placementRefs = useRef<(HTMLButtonElement | null)[]>([])
  const placementIndex = PLACEMENTS.findIndex((opt) => opt.value === placement)
  // placement can't go stale (typed to the two options), but keep the
  // first card tabbable as the fallback so the group stays reachable.
  const tabbablePlacement = placementIndex === -1 ? 0 : placementIndex

  const selectPlacementAt = (index: number) => {
    const target = PLACEMENTS[index]
    if (!target) return
    setPlacement(target.value)
    placementRefs.current[index]?.focus()
  }

  const onPlacementKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % PLACEMENTS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + PLACEMENTS.length) % PLACEMENTS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = PLACEMENTS.length - 1
    }
    if (next !== null) {
      event.preventDefault()
      selectPlacementAt(next)
    }
  }

  const nameLen = cpLength(companyName)
  const textLen = cpLength(text)
  // Title fallbacks mirror how the ticker titles an ad without a company
  // name (the link's host), with a neutral stand-in while both are blank.
  const previewTitle = companyName.trim() || hostFromLink(linkUrl) || 'Your company'
  const previewText = text.trim() || 'Your one line goes here'
  const previewLogo = logoUrl.trim() || fallbackLogoUrl

  // Sample the logo for the preview tint. Debounced — previewLogo
  // changes per keystroke in the logo field — and cancellation-guarded
  // so a slow older sample can't overwrite a newer one.
  useEffect(() => {
    if (!previewLogo) {
      setPreviewAccent(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      extractPreviewAccent(previewLogo).then((hex) => {
        if (!cancelled) setPreviewAccent(hex)
      })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewLogo])

  const submitLabel =
    target.mode === 'create'
      ? 'Submit for review'
      : target.resubmits
        ? 'Resubmit for review'
        : 'Save changes'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setConflict(null)
    try {
      const res = await fetch(
        target.mode === 'create' ? '/api/billboard/submit' : `/api/billboard/${target.adId}`,
        {
          method: target.mode === 'create' ? 'POST' : 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_name: companyName,
            text,
            link_url: linkUrl,
            logo_url: logoUrl.trim() ? logoUrl : null,
            placement,
            // Mirrors the server rule: a slot preference only rides on
            // rail ads. A pick made before switching to the flipper is
            // kept in state (switching back restores it) but not sent.
            requested_rail_slot: placement === 'rail' ? requestedSlot : null,
            billing_email: billingEmail
          })
        }
      )
      const data = await res.json().catch(() => null)

      if (res.status === 409) {
        setConflict(
          typeof data?.error === 'string'
            ? data.error
            : 'This submission conflicts with its current state.'
        )
        onConflict?.()
        return
      }
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Submission failed — try again.')
        return
      }

      if (target.mode === 'create') {
        toast({
          kind: 'success',
          title: 'Submitted for review',
          body: 'A human looks at every card — track it in Your ads.'
        })
        setCompanyName('')
        setText('')
        setLinkUrl('')
        setLogoUrl('')
        setBillingEmail('')
        setPlacement('flipper')
        setRequestedSlot(null)
      } else {
        toast({
          kind: 'success',
          title: target.resubmits ? 'Resubmitted for review' : 'Changes saved',
          body: target.resubmits ? 'Your ad is back in the review queue.' : undefined
        })
      }
      onSaved()
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6">
      {/* ---- live preview: the exact card, on ticker-dark ground. First
          in the DOM so it stacks above the fields on mobile; order-2
          puts it in the sticky right column on lg. ---- */}
      <div className="mb-4 lg:order-2 lg:mb-0 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]">
            Live preview
          </span>
          <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
            Exactly as it airs
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#09090b] px-4 py-5">
          <BillboardCard
            text={previewText}
            title={previewTitle}
            logoUrl={previewLogo}
            accentColor={previewAccent}
            size={placement === 'rail' ? 'rail' : 'lg'}
            className="max-w-full"
          />
        </div>
        {!logoUrl.trim() && fallbackLogoUrl && (
          <p className="mt-1.5 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
            Previewing with your avatar
          </p>
        )}
        <p className="mt-1.5 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
          Final accent color is derived from your logo server-side — the preview approximates it.
        </p>
      </div>

      <div className="space-y-4 lg:order-1">
        {/* ---- placement: which product this card buys ---- */}
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span
              id={placementLabelId}
              className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
            >
              Placement
            </span>
            <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
              Where your card runs
            </span>
          </div>
          <div
            role="radiogroup"
            aria-labelledby={placementLabelId}
            className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {PLACEMENTS.map((opt, i) => {
              const selected = placement === opt.value
              // The rail card's price tracks the picked slot's tier;
              // with none picked it keeps the "from $199" floor.
              const price =
                opt.value === 'rail' && requestedSlot
                  ? `$${RAIL_SLOT_PRICE_CENTS[requestedSlot] / 100}`
                  : opt.price
              return (
                <button
                  key={opt.value}
                  ref={(el) => {
                    placementRefs.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={i === tabbablePlacement ? 0 : -1}
                  onClick={() => setPlacement(opt.value)}
                  onKeyDown={(event) => onPlacementKeyDown(event, i)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)]'
                      : 'border-[color:var(--st-border)] hover:border-[color:var(--st-border-strong)]'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-[color:var(--st-text)]">
                      {opt.label}
                    </span>
                    <span
                      className="shrink-0 text-[12.5px] font-medium"
                      style={{ color: 'rgb(var(--lb-gold) / 0.9)' }}
                    >
                      {price}/wk
                    </span>
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
                    {opt.blurb}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- rail slot preference: a 2x4 grid in the real rail
            geometry (L column, R column, rows top to bottom). Taken
            slots stay selectable — a request is a queue position, not
            a hold; the first confirmed payment takes the slot. ---- */}
        {placement === 'rail' && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span
                id={slotLabelId}
                className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
              >
                Rail slot
              </span>
              <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
                {requestedSlot ? 'Tap again to clear' : 'Optional — any open slot'}
              </span>
            </div>
            <div
              role="group"
              aria-labelledby={slotLabelId}
              className="mt-1.5 grid auto-cols-fr grid-flow-col grid-rows-4 gap-2"
            >
              {RAIL_SLOTS.map((slot) => {
                const selected = requestedSlot === slot
                const takenUntil =
                  board?.rails.find((rail) => rail.slot === slot)?.takenUntil ?? null
                return (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setRequestedSlot(selected ? null : slot)}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      selected
                        ? 'border-[color:var(--st-border-strong)] bg-[color:var(--st-panel-hover)]'
                        : 'border-[color:var(--st-border)] hover:border-[color:var(--st-border-strong)]'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] font-medium text-[color:var(--st-text)]">
                        {slot}
                      </span>
                      <span
                        className="shrink-0 text-[12px] font-medium"
                        style={{ color: 'rgb(var(--lb-gold) / 0.9)' }}
                      >
                        ${RAIL_SLOT_PRICE_CENTS[slot] / 100}/wk
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-[color:var(--st-text-faint)]">
                      {takenUntil
                        ? `taken until ${fmtDate(takenUntil)}`
                        : board
                          ? 'Open'
                          : '\u00A0'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
              {`Pitching a slot doesn't reserve it — the first confirmed payment takes it. If yours sells first, you can switch to any open slot.`}
            </p>
          </div>
        )}

        <FormField
          id={companyId}
          label="Company / brand name"
          aside={
            <span
              className={`text-[12.5px] tabular-nums ${
                nameLen >= BILLBOARD_COMPANY_MAX
                  ? 'text-[color:var(--st-danger)]'
                  : 'text-[color:var(--st-text-faint)]'
              }`}
            >
              {nameLen}/{BILLBOARD_COMPANY_MAX}
            </span>
          }
        >
          <input
            id={companyId}
            value={companyName}
            onChange={(e) => setCompanyName(cpSlice(e.target.value, BILLBOARD_COMPANY_MAX))}
            placeholder="Acme Dev Tools"
            required
            className={fieldInputCls}
          />
        </FormField>

        <FormField
          id={textId}
          label="One line"
          aside={
            <span
              className={`text-[12.5px] tabular-nums ${
                textLen >= BILLBOARD_TEXT_MAX
                  ? 'text-[color:var(--st-danger)]'
                  : 'text-[color:var(--st-text-faint)]'
              }`}
            >
              {textLen}/{BILLBOARD_TEXT_MAX}
            </span>
          }
        >
          <input
            id={textId}
            value={text}
            onChange={(e) => setText(cpSlice(e.target.value, BILLBOARD_TEXT_MAX))}
            placeholder="Ship faster with Acme — the terminal for teams"
            required
            className={fieldInputCls}
          />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={linkId}
            label="Link URL"
            aside={
              <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
                Where a click lands
              </span>
            }
          >
            <input
              id={linkId}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://yoursite.dev"
              required
              inputMode="url"
              className={fieldInputCls}
            />
          </FormField>
          <FormField
            id={logoId}
            label="Logo URL"
            aside={
              <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
                Optional — falls back to your avatar
              </span>
            }
          >
            <input
              id={logoId}
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://yoursite.dev/logo.png"
              inputMode="url"
              className={fieldInputCls}
            />
          </FormField>
        </div>

        <FormField
          id={billingId}
          label="Billing email"
          aside={
            <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
              Private — payment instructions land here
            </span>
          }
        >
          <input
            id={billingId}
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder="you@yoursite.dev"
            required
            autoComplete="email"
            className={fieldInputCls}
          />
        </FormField>

        {conflict && (
          <div
            className={`rounded-lg px-3 py-2.5 text-[13px] leading-5 ${AMBER_FLIP_CLS}`}
            style={{
              color: 'rgb(var(--bb-amber))',
              border: '1px solid rgb(var(--bb-amber) / 0.35)',
              background: 'rgb(var(--bb-amber) / 0.06)'
            }}
            role="status"
          >
            <span className="mr-2 font-medium">
              {target.mode === 'create' ? 'Already in review' : 'Just reviewed'}
            </span>
            {conflict}
          </div>
        )}

        {error && (
          <p
            className="rounded-lg px-3 py-2.5 text-[13px] leading-5"
            style={{
              color: 'var(--st-danger)',
              border: '1px solid var(--st-danger-muted)',
              background: 'var(--st-danger-bg)'
            }}
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          {signedIn === false ? (
            <Link
              href="/login"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-[color:var(--st-accent)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-accent-contrast)] transition-colors duration-150 hover:opacity-90 md:h-8"
            >
              Sign in to submit
            </Link>
          ) : (
            <SettingsButton type="submit" variant="solid" pending={busy}>
              {busy ? 'Sending…' : submitLabel}
            </SettingsButton>
          )}
          {onCancel && (
            <SettingsButton variant="ghost" onClick={onCancel}>
              Cancel
            </SettingsButton>
          )}
        </div>
      </div>
    </form>
  )
}
