'use client'

// Referral plate + modal — the profile's recruit CTA, owner-only, printed
// on the UNIT RECORD's paper.
//
// The plate is the body of the spine's RECRUIT frame (Spine.tsx owns
// the Frame and its bracketed PanelHeader), so it draws no frame of its
// own: the pixel-face headline, the +1,500 numeral in lime print ink with
// its unit, one hairline, then the block's single filled action — the
// ember row that opens the modal. It speaks the spine's row grammar
// (44px on phones, 40px from lg; 11px tracked Plex Mono) and only the
// --pf-* tokens: paper, ink, hairlines, plus the two accent inks the
// dossier assigns to live (lime) and heat (ember). No radius, no glow,
// no sheen. The one motion is the boot count-up, which the profile's
// motion hook drives off data-pf-count exactly as it does RANK and SCORE.
//
// The plate prefetches /api/user/referral on mount (it only renders for
// the profile owner), so the modal usually opens with the link already
// in hand; the result is kept in state so reopening is instant. Reward
// mechanics for the copy: +1,500 PTS per activated friend, first 10
// count, and the grant fires when the friend's extension syncs its
// first real activity.
//
// The modal portals to document.body — outside .pf-dossier — so the
// panel carries the pf-dossier class itself: that is what resolves the
// --pf-* tokens and paints the panel paper. The scrim stays a flat black
// wash so the page behind it never turns paper.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CONTEXT_LINE, PATH_LINK, PATH_X, Stroke } from '@/app/(app)/u/[username]/parts'
import { formatNumber } from '@/components/dashboard-v2/format'
import { SocialIcon } from '@/components/leaderboard/icons'

export const REFERRAL_POINTS = 1_500
export const REFERRAL_CAP = 10

export interface ReferralData {
  code: string
  link: string
  stats: {
    joined: number
    rewarded: number
    pointsEarned: number
    capRemaining: number
  }
}

export const inviteText = (link: string) =>
  `cribble puts your AI coding hours on a live leaderboard. Mine are already on the board — join through my invite and try to outrank me:\n\n${link}`

/** The link as printed in the modal's row: host and path, no scheme. */
export const displayLink = (link: string) => link.replace(/^https?:\/\//i, '')

/** REWARD CAP fill, 0–100: rewarded recruits over the cap. */
export const capPercent = (rewarded: number) =>
  Math.min(100, Math.max(0, (rewarded / REFERRAL_CAP) * 100))

/** What the modal has to show. A link in hand always wins: `failed` only
 *  ever describes a fetch that returned nothing. */
export type ReferralPhase = 'loading' | 'failed' | 'ready'

export const referralPhase = (data: ReferralData | null, failed: boolean): ReferralPhase =>
  data !== null ? 'ready' : failed ? 'failed' : 'loading'

/* ---------- recipes (the spine's row grammar, on paper) ----------
   Colour utilities are appended per use, never stacked, so no two text-
   classes compete for one element. Inks are the --pf-* tokens via
   arbitrary values, the way the panes do it. */

const INK = 'text-[color:var(--pf-ink)]'
const INK_2 = 'text-[color:var(--pf-ink-2)]'
const INK_3 = 'text-[color:var(--pf-ink-3)]'
/** Lime print ink: the reward numeral (live / recruit). Falls back to
 *  plain ink should the dossier not carry the accent yet. */
const LIME_INK = 'text-[color:var(--pf-lime-ink,var(--pf-ink))]'
/** Keyboard focus as a 1px ink outline — rings are box-shadows, and the
 *  paper has none. */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-ink)]'
/** 11px tracked Plex Mono row label; the caller sets height and colour. */
const ROW_TYPE = 'font-data text-[11px] font-medium uppercase tracking-[0.18em]'
/** The one filled action per view: solid ember with its own foreground.
 *  Falls back to the ink plate should the accent tokens be missing, so
 *  the row never renders as bare text. */
const EMBER_ROW = `flex w-full items-center justify-center gap-2 bg-[color:var(--pf-ember,var(--pf-plate))] text-[color:var(--pf-ember-fg,var(--pf-plate-fg))] transition-opacity enabled:hover:opacity-90 disabled:opacity-40 ${ROW_TYPE} ${FOCUS_RING}`
/** Framed secondary control (COPY, RETRY, close); colour appended per use. */
const FRAMED = `pf-frame flex shrink-0 items-center justify-center transition-colors hover:bg-[color:var(--pf-paper-3)] hover:text-[color:var(--pf-ink)] ${FOCUS_RING}`
/** Modal rows: 44px on phones, 40px with a pointer. */
const MODAL_ROW_H = 'h-11 sm:h-10'
/** Press Start 2P numeral; the caller sets size and ink. */
const PIXEL = '[font-family:var(--font-pixel)] leading-none tabular-nums'
/** Stat numeral size. Below sm the stats stack as rows, so the numeral
 *  has the whole row's right half; from sm it shares a third of the
 *  modal body with two neighbours — 15px clears both. */
const CELL_NUMERAL = `${PIXEL} text-[15px]`
/** Loading bars: paper-2 blocks, pulse only when motion is allowed. */
const SKELETON = 'bg-[color:var(--pf-paper-2)] animate-pulse motion-reduce:animate-none'
/** Hairline-cell divider (the RECORD grid's recipe). */
const CELL_EDGE = 'border-l border-t border-[color:var(--pf-line-soft)]'

export function ReferralPlate() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ReferralData | null>(null)
  const [failed, setFailed] = useState(false)
  // In-flight guard: RETRY calls load() directly AND flips `failed`,
  // which re-runs the effect below — without the guard that races two
  // parallel fetches.
  const inFlightRef = useRef(false)

  const load = useCallback(() => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setFailed(false)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    fetch('/api/user/referral', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('referral fetch failed'))))
      .then((d) => {
        if (typeof d?.link !== 'string' || !d?.stats) throw new Error('referral fetch failed')
        setData(d as ReferralData)
      })
      .catch(() => setFailed(true))
      .finally(() => {
        clearTimeout(timer)
        inFlightRef.current = false
      })
  }, [])

  // Prefetch on mount so the modal opens with the link ready; the
  // result is kept so (re)opening is instant. A failed prefetch parks
  // on the modal's RETRY state instead of refetching automatically.
  useEffect(() => {
    if (!data && !failed) load()
  }, [data, failed, load])

  return (
    <>
      <div>
        {/* headline — 15 glyphs at 1em each: 14px clears the 296px spine's
            ~230px inner width on one line; phones get the larger cut. It
            wraps rather than truncates should the frame ever be narrower. */}
        <p className={`[font-family:var(--font-pixel)] text-[17px] leading-[1.3] lg:text-[14px] ${INK}`}>
          INVITE A FRIEND
        </p>

        {/* numeral + unit: side by side where they fit (phones), the unit
            drops under the numeral in the spine. The boot count-up rewrites
            the numeral from "+0" up, so it reserves its final width —
            "+1,500" is 6 glyphs at 1em each in the pixel face — and the
            wrap (hence the frame's height) is settled from the first frame. */}
        <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <span
            className={`${PIXEL} min-w-[6em] text-[24px] lg:text-[22px] ${LIME_INK}`}
            data-pf-count={REFERRAL_POINTS}
            data-pf-format="int"
            data-pf-prefix="+"
          >
            {`+${formatNumber(REFERRAL_POINTS)}`}
          </span>
          <span className="pf-micro">PTS PER RECRUIT</span>
        </p>
        <p className={`${CONTEXT_LINE} mt-2`}>FIRST {REFERRAL_CAP} RECRUITS COUNT</p>

        <div aria-hidden className="pf-rule mt-4" />

        {/* the block's one filled action */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`${EMBER_ROW} mt-4 min-h-11 lg:min-h-10`}
        >
          <Stroke d={PATH_LINK} size={11} />
          GET INVITE LINK
        </button>
      </div>

      {open && (
        <ReferralModal data={data} failed={failed} onRetry={load} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/* ================= modal ================= */

function ReferralModal({
  data,
  failed,
  onRetry,
  onClose
}: {
  data: ReferralData | null
  failed: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phase = referralPhase(data, failed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // The COPIED flash must not outlive the modal.
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )

  const copy = useCallback(() => {
    if (!data) return
    void navigator.clipboard
      ?.writeText(data.link)
      .then(() => {
        setCopied(true)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 1600)
      })
      // Denied/unavailable clipboard: swallow the rejection and skip
      // the COPIED flash — the link text stays selectable by hand.
      .catch(() => {})
  }, [data])

  const postOnX = useCallback(() => {
    if (!data) return
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(inviteText(data.link))}`,
      '_blank',
      'noopener,noreferrer'
    )
  }, [data])

  const stats = data?.stats
  const rewarded = stats?.rewarded ?? 0

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
      role="dialog"
      aria-modal="true"
      aria-label="Recruit a pilot"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />

      {/* the panel is the paper: pf-dossier resolves the tokens and fills
          it, pf-screen lays the sheet's dot-screen over that, pf-frame is
          the 1px line */}
      <div className="pf-dossier pf-screen pf-frame relative flex max-h-[calc(100svh-2rem)] w-full max-w-md flex-col overflow-hidden sm:max-h-[calc(100vh-3rem)]">
        {/* ---------- header ---------- */}
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--pf-line)] py-2 pl-4 pr-2 sm:pl-5 sm:pr-3">
          <h2 className="pf-label whitespace-nowrap">
            <span aria-hidden>{'[ '}</span>
            RECRUIT A PILOT
            <span aria-hidden>{' ]'}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`${FRAMED} h-11 w-11 sm:h-10 sm:w-10 ${INK_2}`}
          >
            <Stroke d={PATH_X} size={13} />
          </button>
        </div>

        {/* ---------- body ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          <p className={`text-[13px] leading-relaxed ${INK_2}`}>
            Hand a friend your personal link. They skip the gate — you bank{' '}
            <span className={`font-data font-medium ${LIME_INK}`}>
              +{formatNumber(REFERRAL_POINTS)} PTS
            </span>{' '}
            once they&apos;re flying.
          </p>

          {/* link + copy */}
          <div className="mt-4">
            <div className="pf-micro">YOUR INVITE LINK</div>
            <div className="mt-1.5 flex items-stretch gap-2">
              <LinkRow
                phase={phase}
                link={data?.link ?? null}
                copied={copied}
                onCopy={copy}
                onRetry={onRetry}
              />
            </div>
          </div>

          {/* primary action — the view's one filled row */}
          <button
            type="button"
            onClick={postOnX}
            disabled={phase !== 'ready'}
            className={`${EMBER_ROW} ${MODAL_ROW_H} mt-3`}
          >
            <SocialIcon kind="x" size={11} />
            POST ON X
          </button>

          {/* stats — the RECORD grid's hairline cells: each owns its top +
              left rule, the -1px offset tucks the outer pair under the frame
              at either column count. Stacked rows below sm (a 320px modal
              body is ~67px per third, short of what PTS EARNED / OF 15,000
              need), three columns from sm. */}
          <div className="pf-frame mt-5 overflow-hidden">
            <div className="-ml-px -mt-px grid grid-cols-1 sm:grid-cols-3">
              <Cell label="JOINED" sub="VIA LINK" value={stats?.joined ?? 0} phase={phase} />
              <Cell label="REWARDED" sub="ACTIVATED" value={rewarded} phase={phase} />
              <Cell
                label="PTS EARNED"
                sub={`OF ${formatNumber(REFERRAL_POINTS * REFERRAL_CAP)}`}
                value={stats?.pointsEarned ?? 0}
                phase={phase}
              />
            </div>
          </div>

          {/* cap progress — paper-2 track, ink fill */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="pf-micro">REWARD CAP</span>
              <span className="pf-micro tabular-nums">
                {phase === 'failed' ? '—' : rewarded}/{REFERRAL_CAP}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden bg-[color:var(--pf-paper-2)]">
              <div
                className="pf-fill h-full bg-[color:var(--pf-ink)] transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${capPercent(rewarded)}%` }}
              />
            </div>
          </div>

          <p className={`${CONTEXT_LINE} mt-4 border-t border-[color:var(--pf-line-soft)] pt-3 leading-relaxed`}>
            The reward lands when your friend&apos;s extension syncs its first real activity —{' '}
            +{formatNumber(REFERRAL_POINTS)} PTS each, first {REFERRAL_CAP} recruits count.
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ---------- modal pieces ---------- */

/** YOUR INVITE LINK row: the link in a frame beside COPY (ready), a
 *  dashed LINK UNAVAILABLE frame beside RETRY (failed), or one framed
 *  skeleton bar (loading). COPIED is a hairline flash — the frame and
 *  label turn full ink for 1.6s — not a pop. */
function LinkRow({
  phase,
  link,
  copied,
  onCopy,
  onRetry
}: {
  phase: ReferralPhase
  link: string | null
  copied: boolean
  onCopy: () => void
  onRetry: () => void
}) {
  const frame = `pf-frame flex min-w-0 flex-1 items-center px-3 ${MODAL_ROW_H}`
  const control = `${FRAMED} ${MODAL_ROW_H} min-w-[5.5rem] px-3 ${ROW_TYPE}`

  switch (phase) {
    case 'ready':
      return (
        <>
          <div className={frame}>
            <span className={`truncate font-data text-[13px] ${INK}`}>
              {link !== null ? displayLink(link) : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={onCopy}
            className={`${control} ${copied ? INK : INK_2}`}
            // .pf-frame's border shorthand outranks a border-colour
            // utility of equal specificity, so the flash goes inline.
            style={copied ? { borderColor: 'var(--pf-ink)' } : undefined}
          >
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </>
      )
    case 'failed':
      return (
        <>
          <div className={frame} style={{ borderStyle: 'dashed' }}>
            <span className="pf-micro truncate">LINK UNAVAILABLE</span>
          </div>
          <button type="button" onClick={onRetry} className={`${control} ${INK_2}`}>
            RETRY
          </button>
        </>
      )
    case 'loading':
      return (
        <div className={frame} aria-busy="true">
          <span className={`h-3 w-44 ${SKELETON}`} />
        </div>
      )
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

/** One stat: pixel numeral when the fetch is in, an ink-3 dash when it
 *  failed, a paper-2 bar while it loads. One DOM order, two layouts via
 *  grid auto-placement — below sm a 44px hairline ROW: label and context
 *  stacked on the left (column 1), the numeral spanning both of their
 *  rows on the right (column 2), centred; from sm StatCell's three-row
 *  anatomy (label / numeral row / context) in a single column so the
 *  three cells land on the same baselines. Tighter padding than the
 *  RECORD grid — three cells share a modal body from sm. */
function Cell({
  label,
  sub,
  value,
  phase
}: {
  label: string
  sub: string
  value: number
  phase: ReferralPhase
}) {
  return (
    <div
      className={`${CELL_EDGE} grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 sm:min-h-0 sm:grid-cols-1 sm:py-3.5`}
    >
      <div className="pf-micro truncate">{label}</div>
      <div className="row-span-2 flex h-[15px] items-end justify-self-end sm:mt-2.5 sm:row-span-1 sm:justify-self-start">
        <CellValue value={value} phase={phase} />
      </div>
      <div className={`${CONTEXT_LINE} mt-1 truncate sm:mt-2`}>{sub}</div>
    </div>
  )
}

function CellValue({ value, phase }: { value: number; phase: ReferralPhase }) {
  switch (phase) {
    case 'ready':
      return <span className={`${CELL_NUMERAL} ${INK}`}>{formatNumber(value)}</span>
    case 'failed':
      return <span className={`${CELL_NUMERAL} ${INK_3}`}>—</span>
    case 'loading':
      return <span className={`h-[15px] w-8 ${SKELETON}`} />
    default: {
      const exhaustive: never = phase
      return exhaustive
    }
  }
}
