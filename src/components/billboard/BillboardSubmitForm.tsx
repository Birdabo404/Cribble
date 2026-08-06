'use client'

// The buyer's ad composer — used twice on /billboard: as the main
// submission form (POST /api/billboard/submit) and, embedded in the
// status tracker, as the edit / edit-and-resubmit form for a PENDING or
// CHANGES_REQUESTED ad (PATCH /api/billboard/[id]). The placement
// picker chooses which product the card buys — the rotating flipper
// strip or an always-on profile rail — and ships as `placement` on both
// create and edit. The live preview is the real BillboardCard in the
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
  BILLBOARD_RAIL_PRICE_CENTS,
  BILLBOARD_TEXT_MAX,
  type BillboardPlacement
} from '@/lib/billboard'

export interface AdFormValues {
  company_name: string
  text: string
  link_url: string
  logo_url: string
  placement: BillboardPlacement
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
 *  constants so a repricing lands here automatically. */
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
    price: `$${BILLBOARD_RAIL_PRICE_CENTS / 100}`,
    blurb: 'Always-on card beside every profile page.'
  }
]

const fieldInputCls = 'st-input block w-full rounded-lg px-3 py-1.5 text-[14px] leading-6'

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
  const [placement, setPlacement] = useState<BillboardPlacement>(initial?.placement ?? 'flipper')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [previewAccent, setPreviewAccent] = useState<string | null>(null)

  const uid = useId()
  const companyId = `${uid}-company`
  const textId = `${uid}-text`
  const linkId = `${uid}-link`
  const logoId = `${uid}-logo`
  const placementLabelId = `${uid}-placement`

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
            placement
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
        setPlacement('flipper')
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
                      {opt.price}/wk
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
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-[color:var(--st-accent)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-accent-contrast)] transition-colors duration-150 hover:opacity-90"
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
