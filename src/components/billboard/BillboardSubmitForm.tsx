'use client'

// The buyer's ad composer — used twice on /sponsorship: as the main
// submission form (POST /api/billboard/submit) and, embedded in the
// status tracker, as the edit / edit-and-resubmit form for a PENDING or
// CHANGES_REQUESTED ad (PATCH /api/billboard/[id]). The placement
// picker chooses which product the card buys — the rotating flipper
// strip, an always-on profile rail, or the leaderboard sponsor board
// (migration 055, bid-priced rather than weekly) — and ships as
// `placement` on both create and edit. Picking the rail reveals the 2x4
// slot grid (L1-L4, R1-R4 — the same eight rows the profile's
// TRANSMISSIONS panel lists), fed by /api/billboard/slots (fetched here, not by
// a parent, because the form mounts in both contexts): the buyer may
// request a specific slot, shipped as `requested_rail_slot` on create
// and edit. Taken slots stay selectable — a request is a preference
// resolved first-confirmed-payment-first, never a hold — and the rail
// placement card's price live-tracks the selected slot's ladder tier.
// The preview is BillboardPreviewStage, fed the form values as typed
// with the caller's avatar standing in while the logo URL is blank — so
// the composer always shows exactly the card that airs. The accent tint
// is best-effort client-side (canvas-sampled from the logo); the
// shipped color is extracted server-side at submit.
//
// The logo takes two shapes: a pasted https URL, or an image uploaded
// through POST /api/billboard/logo — which compresses it in memory and
// returns a small inline data URI (nothing is kept on any server
// storage) that this form then carries in the same logo_url value. The
// two are mutually exclusive: uploading replaces whatever URL was
// typed, and clearing the upload reopens the URL input.
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
// /sponsorship page shell provides.
//
// Layout: one column of fields either way, with two shells around it.
// 'studio' is the buy page, where an inventory strip owns the product
// choice and a big sticky stage owns the preview: the form renders
// neither, and instead reports its resolved preview values up through
// onPreviewChange. 'embedded' is the tracker's edit row, which has no
// such surroundings, so it keeps the placement and slot pickers and
// leads with a compact stage above the fields — the card is the product
// hook.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { BillboardPreviewStage } from '@/components/billboard/BillboardPreviewStage'
import { SettingsButton } from '@/components/settings'
import { toast } from '@/components/Toaster'
import {
  BILLBOARD_COMPANY_MAX,
  BILLBOARD_LOGO_UPLOAD_MAX_BYTES,
  BILLBOARD_PRICE_CENTS,
  BILLBOARD_RAIL_PRICE_MIN_CENTS,
  BILLBOARD_TEXT_MAX,
  RAIL_SLOT_PRICE_CENTS,
  RAIL_SLOTS,
  type BillboardPlacement,
  type RailSlot,
  type SlotBoard
} from '@/lib/billboard'
import {
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  formatSponsorUsd
} from '@/lib/leaderboardSponsor'

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

/** What the preview stage needs, already resolved: placeholders applied,
 *  avatar substituted for a blank logo, accent sampled. Reported upward
 *  in the studio layout so the parent's sticky stage paints the card the
 *  buyer is typing without duplicating any of that resolution. */
export interface AdPreviewValues {
  title: string
  text: string
  logoUrl: string | null
  /** The debounced client-side sample; null = the neutral card. */
  accentColor: string | null
  placement: BillboardPlacement
  requestedSlot: RailSlot | null
  /** True while the logo field is blank and the avatar is standing in. */
  usingAvatarFallback: boolean
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

/** The three products a card can buy — prices derive from the shared
 *  constants so a repricing lands here automatically, and each entry
 *  carries its full price string (the weekly products wear /wk, the
 *  leaderboard bid doesn't — it's pay-per-bid). The rail card carries
 *  the ladder floor ("from $199/wk"); the render overrides it with the
 *  selected slot's exact price once one is picked. */
const PLACEMENTS: {
  value: BillboardPlacement
  label: string
  price: string
  blurb: string
}[] = [
  {
    value: 'flipper',
    label: 'Flipper',
    price: `$${BILLBOARD_PRICE_CENTS / 100}/wk`,
    blurb: 'Rotates under the nav on the dashboard + leaderboard.'
  },
  {
    value: 'rail',
    label: 'Transmissions panel',
    price: `from $${BILLBOARD_RAIL_PRICE_MIN_CENTS / 100}/wk`,
    blurb: 'Always-on cell in the profile transmissions panel, 1024px and up.'
  },
  {
    value: 'leaderboard',
    label: 'Leaderboard bid',
    price: `from ${formatSponsorUsd(LEADERBOARD_SPONSOR_OPENING_CENTS)}`,
    blurb: 'Ranked sponsor face on the leaderboard — bid to hold #1.'
  }
]

const fieldInputCls =
  'st-input block w-full rounded-lg px-3 py-2.5 text-[16px] leading-6 md:py-1.5 md:text-[15px]'

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
  layout = 'embedded',
  onSaved,
  onConflict,
  onCancel,
  onPreviewChange
}: {
  target: AdFormTarget
  initial?: AdFormValues
  /** The user's avatar — stands in on the preview while logo_url is blank,
   *  mirroring how the ticker renders ads without a logo. */
  fallbackLogoUrl: string | null
  /** 'studio' drops the placement / slot pickers and the preview — the
   *  buy page's inventory strip and sticky stage own both, and remount
   *  the form with the choice preset on `initial`. 'embedded' (the
   *  tracker's edit row) keeps the pickers and its own compact stage. */
  layout?: 'studio' | 'embedded'
  onSaved: () => void
  /** Fired on 409 so the caller can refresh the tracker — either the
   *  in-flight submission (create) or a concurrent admin decision (edit). */
  onConflict?: () => void
  onCancel?: () => void
  /** Resolved preview values, on mount and on every change, so a parent
   *  stage can render the card as it's typed. */
  onPreviewChange?: (preview: AdPreviewValues) => void
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
  /** Set after a guest submission (response guest: true): the server
   *  minted a claim cookie for this browser and — unless the response
   *  said trackingEmailSent: false — emailed a tracking magic link to
   *  the billing email. Kept until the next submit attempt so the
   *  visitor reads it after the fields reset. */
  const [guestNotice, setGuestNotice] = useState<{
    email: string
    emailSent: boolean
  } | null>(null)
  const [previewAccent, setPreviewAccent] = useState<string | null>(null)
  /** Upload flow state. uploadAccent is the server-extracted color that
   *  rode the /api/billboard/logo response — preferred over the canvas
   *  sample while the logo value is that upload's data URI. */
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadAccent, setUploadAccent] = useState<string | null>(null)
  const logoFileRef = useRef<HTMLInputElement | null>(null)

  const uid = useId()
  const companyId = `${uid}-company`
  const textId = `${uid}-text`
  const linkId = `${uid}-link`
  const logoId = `${uid}-logo`
  const billingId = `${uid}-billing`
  const placementLabelId = `${uid}-placement`
  const slotLabelId = `${uid}-slot`

  // The picker's availability, fetched by the form itself because only
  // the embedded layout renders a picker and only it knows when the rail
  // is in play. Best-effort, same guard as the landing's board fetch.
  // Skipped in the studio layout, which renders no picker (and remounts
  // per inventory pick, so a fetch here would fire on every click).
  useEffect(() => {
    if (layout !== 'embedded') return
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
  }, [layout])

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
  const usingAvatarFallback = !logoUrl.trim() && !!fallbackLogoUrl
  /** True while the logo value is an uploaded inline image (the data
   *  URI minted by /api/billboard/logo) rather than a pasted URL —
   *  covers edit mode reopening an ad whose logo was uploaded. */
  const logoIsUpload = logoUrl.startsWith('data:')

  // Sample the logo for the preview tint. Debounced — previewLogo
  // changes per keystroke in the logo field — and cancellation-guarded
  // so a slow older sample can't overwrite a newer one. An uploaded
  // logo skips the sample when the upload response already delivered
  // the server-extracted accent — the same extractor that runs at
  // submit, so the preview tint IS the shipped tint. (Edit mode can
  // reopen a stored upload without one; the sample below covers that,
  // and a data URI never taints the canvas.)
  useEffect(() => {
    if (!previewLogo) {
      setPreviewAccent(null)
      return
    }
    if (previewLogo.startsWith('data:') && uploadAccent) {
      setPreviewAccent(uploadAccent)
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
  }, [previewLogo, uploadAccent])

  // Report the resolved preview upward — on mount too, so a parent stage
  // paints real values instead of its own placeholders for a frame.
  useEffect(() => {
    onPreviewChange?.({
      title: previewTitle,
      text: previewText,
      logoUrl: previewLogo,
      accentColor: previewAccent,
      placement,
      requestedSlot,
      usingAvatarFallback
    })
  }, [
    previewTitle,
    previewText,
    previewLogo,
    previewAccent,
    placement,
    requestedSlot,
    usingAvatarFallback,
    onPreviewChange
  ])

  /** Client half of the logo upload: pre-check the 2MB cap for a
   *  friendly error before any network, POST the file to
   *  /api/billboard/logo (compressed fully in memory server-side —
   *  nothing lands on any server storage), then adopt the returned
   *  inline data URI as the logo value and its server-extracted accent
   *  for the preview. Replaces whatever URL was typed — the two logo
   *  shapes are mutually exclusive. */
  const onLogoFilePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    event.target.value = ''
    if (!file || uploading) return
    setUploadError(null)
    if (file.size > BILLBOARD_LOGO_UPLOAD_MAX_BYTES) {
      setUploadError('That image is over 2 MB — pick a smaller file.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/billboard/logo', {
        method: 'POST',
        credentials: 'include',
        body: form
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || typeof data?.logoData !== 'string') {
        setUploadError(
          typeof data?.error === 'string' ? data.error : 'Upload failed — try again.'
        )
        return
      }
      setLogoUrl(data.logoData)
      setUploadAccent(typeof data.accentColor === 'string' ? data.accentColor : null)
    } catch {
      setUploadError('Network error — try again.')
    } finally {
      setUploading(false)
    }
  }

  const clearUploadedLogo = () => {
    setLogoUrl('')
    setUploadAccent(null)
    setUploadError(null)
  }

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
    setGuestNotice(null)
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
        // A guest submission (no session) answers with guest: true —
        // the response set the claim cookie for this browser, and
        // (unless it says otherwise) mailed a tracking magic link.
        // Capture the billing email before the reset below clears it.
        if (data?.guest === true) {
          setGuestNotice({
            email: billingEmail.trim(),
            emailSent: data?.trackingEmailSent !== false
          })
        }
        toast({
          kind: 'success',
          title: 'Submitted for review',
          body: 'A human looks at every card — track it in Your ads.'
        })
        setCompanyName('')
        setText('')
        setLinkUrl('')
        setLogoUrl('')
        setUploadAccent(null)
        setUploadError(null)
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
    <form onSubmit={submit} className="space-y-4">
      {/* ---- the edit row inside the tracker has no stage around it, so
          it leads with a compact one. Studio's parent owns the full-size
          stage and feeds it from onPreviewChange. ---- */}
      {layout === 'embedded' && (
        <BillboardPreviewStage
          title={previewTitle}
          text={previewText}
          logoUrl={previewLogo}
          accentColor={previewAccent}
          placement={placement}
          slot={requestedSlot}
          density="compact"
          note={usingAvatarFallback ? 'Previewing with your avatar' : null}
        />
      )}

      {/* ---- which product this card buys, and where on the rail. Studio
          hides both: the inventory strip above the form owns the choice
          and remounts the form with it preset on `initial`. ---- */}
      {layout === 'embedded' && (
        <div className="space-y-4">
          {/* ---- placement ---- */}
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
              className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {PLACEMENTS.map((opt, i) => {
                const selected = placement === opt.value
                // The rail card's price tracks the picked slot's tier;
                // with none picked it keeps the "from $199/wk" floor.
                const price =
                  opt.value === 'rail' && requestedSlot
                    ? `$${RAIL_SLOT_PRICE_CENTS[requestedSlot] / 100}/wk`
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
                        {price}
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

          {/* ---- rail slot preference: the 2x4 slot grid (L column, R
              column, rows top to bottom — the ladder's price tiers). Taken
              slots stay selectable — a request is a queue position, not
              a hold; the first confirmed payment takes the slot. ---- */}
          {placement === 'rail' && (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span
                  id={slotLabelId}
                  className="text-[13px] font-medium leading-5 text-[color:var(--st-text)]"
                >
                  Transmissions slot
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
        </div>
      )}

      <div className="space-y-4">
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
            label="Logo"
            aside={
              <span className="text-[12.5px] text-[color:var(--st-text-faint)]">
                Optional — falls back to your avatar
              </span>
            }
          >
            {/* ---- two mutually exclusive shapes: an uploaded inline
                image renders as a thumbnail chip with a remove control;
                otherwise the URL input plus the upload affordance.
                Removing the upload reopens the input, and uploading
                replaces whatever URL was typed. ---- */}
            {logoIsUpload ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-[color:var(--st-border)] py-1 pl-3 pr-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt=""
                  aria-hidden
                  className="h-7 w-7 shrink-0 rounded-md object-contain"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--st-text)]">
                  Uploaded logo
                </span>
                <SettingsButton variant="ghost" onClick={clearUploadedLogo}>
                  Remove
                </SettingsButton>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  id={logoId}
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://yoursite.dev/logo.png"
                  inputMode="url"
                  className={`${fieldInputCls} min-w-0 flex-1`}
                />
                <SettingsButton
                  variant="ghost"
                  pending={uploading}
                  onClick={() => logoFileRef.current?.click()}
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </SettingsButton>
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onLogoFilePicked}
                />
              </div>
            )}
            {uploadError && (
              <p
                className="mt-1.5 text-[12.5px] leading-5"
                style={{ color: 'var(--st-danger)' }}
                role="alert"
              >
                {uploadError}
              </p>
            )}
            <p className="mt-1.5 text-[12px] leading-5 text-[color:var(--st-text-faint)]">
              {logoIsUpload
                ? 'Auto-compressed and stored inline with your ad — nothing is kept on any server storage.'
                : 'Paste a URL or upload an image (up to 2 MB) — uploads are auto-compressed and stored inline, never kept on any server storage.'}
            </p>
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

        {/* ---- the guest afterglow: the fields just reset, so this
            panel is what tells an anonymous sponsor where their card
            went and how to find it again from another device. ---- */}
        {guestNotice && (
          <div
            className="rounded-lg border border-[color:var(--st-border)] px-3 py-2.5 text-[13px] leading-5 text-[color:var(--st-text-muted)]"
            role="status"
          >
            <span className="mr-2 font-medium text-[color:var(--st-text)]">
              {guestNotice.emailSent ? 'Submitted — tracking link sent' : 'Submitted'}
            </span>
            {guestNotice.emailSent ? (
              <>
                Your card is in review. A tracking link is on its way to{' '}
                <span className="font-medium text-[color:var(--st-text)]">
                  {guestNotice.email}
                </span>{' '}
                — open it on any device to find this card again. The Your ads tab on
                this page tracks it too.
              </>
            ) : (
              <>Your card is in review — track it in Your ads on this page.</>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <SettingsButton type="submit" variant="solid" pending={busy}>
              {busy ? 'Sending…' : submitLabel}
            </SettingsButton>
            {onCancel && (
              <SettingsButton variant="ghost" onClick={onCancel}>
                Cancel
              </SettingsButton>
            )}
          </div>
          <p className="text-[12.5px] leading-5 text-[color:var(--st-text-faint)]">
            {/* The money story differs per product: the weekly slots are
                paid manually over email after approval; the leaderboard
                bid is a card checkout the buyer starts from Your ads —
                and its approval is one-time, so edits cost a re-review. */}
            {placement === 'leaderboard'
              ? 'Nothing charges at submission. Approval is one-time — once approved, you bid by card from Your ads, and edits send the card back through review.'
              : 'Nothing charges automatically. Payment is arranged over email after approval.'}
          </p>
        </div>
      </div>
    </form>
  )
}
