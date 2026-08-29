'use client'

// COIN-UP — the CURSOR burn board's opt-in as an arcade credit sequence.
// Not a form modal: a small ember-phosphor CRT handheld (the attract
// hero's tube physics wearing the burn board's orange) asking you to
// enter your initials before you play. Every state is diegetic:
//
//   BOOT   static burst + sliced glitch-in (channel-switch grammar)
//   IDENT  "NEW CHALLENGER DETECTED" — cursor.com/@handle with a
//          blinking block cursor; Enter submits, typing never waits
//          for the choreography
//   SCAN   the real POST /api/user/cursor-profile races typed uplink
//          lines and an 18-cell block bar; errors come back as NO
//          CARRIER / SIGNAL SCRAMBLED and drop you back to IDENT live
//   REVEAL avatar dithers in cell-by-cell (pixelAvatar grids), stats
//          count up in pixel numerals, then ENTERING AT RANK #N stamps
//          in from a fresh /api/leaderboard/cursor-agents read
//
// Reduced motion (OS pref + the app's data-motion kill switch) renders
// every phase statically. The onClose/onLinked contract is unchanged so
// CursorBoard's JOIN button keeps working; onViewBoard is the optional
// success CTA for callers that can jump to the CURSOR source.

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatNumber } from '@/components/dashboard-v2/format'
import {
  glyphFor,
  identiconGrid,
  imageGrid,
  type PixelGrid
} from '@/components/leaderboard/pixelAvatar'
import { fetchMe as requestMe } from '@/lib/client/fetchMe'
import type { CursorBoardWindowId } from '@/lib/cursorProfileBoard'
import { prefersReducedMotion } from '@/lib/motion'
import {
  exactIntegerToSafeNumber,
  formatCompactTokenCount
} from '@/lib/tokenLeaderboard'

gsap.registerPlugin(useGSAP)

export interface CursorOptInProfile {
  cursorUsername: string
  displayName: string | null
  avatarUrl: string | null
  stats: {
    tokens30d: string
    agentsLocal: number
    agentsCloud: number
    currentStreak: number
  }
}

const BAR_CELLS = 18
/** The scan beat needs room to land even when the claim resolves fast. */
const MIN_SCAN_MS = 900
/** One extra beat with the bar pegged at 100% before the reveal flips in. */
const BAR_SNAP_MS = 220

function reducedNow(): boolean {
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

/** OS media query + Cribble's in-app data-motion kill switch, live —
 *  the same check CrtAttract runs. Lazy-init reads the real preference
 *  before the first GSAP layout effect fires (this component only ever
 *  renders client-side), so reduced users never get one animated frame. */
function useReducedMotionLive(): boolean {
  const [reduced, setReduced] = useState(() => reducedNow())
  useEffect(() => {
    const compute = () => setReduced(reducedNow())
    compute()
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', compute)
    const mo = new MutationObserver(compute)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    })
    return () => {
      mq.removeEventListener('change', compute)
      mo.disconnect()
    }
  }, [])
  return reduced
}

/** Bracketed block-glyph uplink bar: `████▓·····` for a 0..1 fraction. */
function barString(frac: number): string {
  const clamped = Math.max(0, Math.min(1, frac))
  const filled = clamped * BAR_CELLS
  const full = Math.floor(filled)
  const rem = filled - full
  let s = '█'.repeat(full)
  if (full < BAR_CELLS) s += rem > 0.66 ? '▓' : rem > 0.33 ? '▒' : '░'
  return (s + '·'.repeat(BAR_CELLS)).slice(0, BAR_CELLS)
}

type GridLine = { ch: string; a: number }[]

function gridToLines(grid: PixelGrid): GridLine[] {
  const lines: GridLine[] = []
  for (let r = 0; r < grid.rows; r++) {
    const line: GridLine = []
    for (let c = 0; c < grid.cols; c++) {
      const lum = grid.lum[r * grid.cols + c]
      line.push({ ch: glyphFor(lum), a: Math.round((0.45 + lum * 0.55) * 100) / 100 })
    }
    lines.push(line)
  }
  return lines
}

/* ================= wire parsing ================= */

function parseProfile(payload: unknown): CursorOptInProfile | null {
  if (typeof payload !== 'object' || payload === null) return null
  const body = payload as {
    linked?: unknown
    profile?: {
      cursorUsername?: unknown
      displayName?: unknown
      avatarUrl?: unknown
      stats?: {
        tokens30d?: unknown
        agentsLocal?: unknown
        agentsCloud?: unknown
        currentStreak?: unknown
      }
    }
  }
  if (body.linked !== true || !body.profile) return null
  const profile = body.profile
  if (typeof profile.cursorUsername !== 'string') return null
  return {
    cursorUsername: profile.cursorUsername,
    displayName: typeof profile.displayName === 'string' ? profile.displayName : null,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null,
    stats: {
      tokens30d:
        typeof profile.stats?.tokens30d === 'string' ? profile.stats.tokens30d : '0',
      agentsLocal: Number(profile.stats?.agentsLocal) || 0,
      agentsCloud: Number(profile.stats?.agentsCloud) || 0,
      currentStreak: Number(profile.stats?.currentStreak) || 0
    }
  }
}

/** Diegetic error transmissions — the scan falls back to IDENT with one
 *  of these on the wire. `private` additionally renders the settings link. */
type ScanError = {
  code: 'empty' | 'not-found' | 'private' | 'claimed' | 'cooldown' | 'garbled' | 'dropped'
  title: string
  detail: string
}

function mapScanError(status: number | null, serverMessage: string | null): ScanError {
  if (status === 404) {
    return {
      code: 'not-found',
      title: 'NO CARRIER — PROFILE NOT FOUND',
      detail: 'NOTHING ANSWERS AT THAT HANDLE. CHECK IT AND DIAL AGAIN.'
    }
  }
  if (status === 400 && serverMessage && /public/i.test(serverMessage)) {
    return {
      code: 'private',
      title: 'SIGNAL SCRAMBLED — PROFILE IS PRIVATE',
      detail: ''
    }
  }
  if (status === 409) {
    return {
      code: 'claimed',
      title: 'CHANNEL OCCUPIED — HANDLE ALREADY CLAIMED',
      detail: 'THAT HANDLE RIDES ANOTHER CRIBBLE ACCOUNT.'
    }
  }
  if (status === 429) {
    return {
      code: 'cooldown',
      title: 'LINE BUSY — TOO MANY DIAL ATTEMPTS',
      detail: 'THE SWITCHBOARD NEEDS A MOMENT. TRY AGAIN SHORTLY.'
    }
  }
  if (status === 400) {
    return {
      code: 'garbled',
      title: 'BAD FREQUENCY — HANDLE REJECTED',
      detail: serverMessage
        ? serverMessage.toUpperCase()
        : 'THAT DOES NOT LOOK LIKE A CURSOR.COM HANDLE.'
    }
  }
  return {
    code: 'dropped',
    title: 'LINK DROPPED — UPLINK FAILED',
    detail: 'CURSOR.COM DID NOT PICK UP. TRY AGAIN IN A MOMENT.'
  }
}

/** Locate the viewer's fresh row on the CURSOR board for the rank stamp.
 *  Any failure resolves null — the reveal falls back to rankless copy. */
async function lookupRank(rankWindow: CursorBoardWindowId): Promise<number | null> {
  try {
    const me = await requestMe()
    if (!me.ok || !me.data.user?.id) return null
    const viewerId = Number(me.data.user.id)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const query = new URLSearchParams({ window: rankWindow, timezone })
    const response = await fetch(`/api/leaderboard/cursor-agents?${query}`, {
      cache: 'no-store'
    })
    const data: { success?: unknown; rows?: { userId?: unknown; rank?: unknown }[] } | null =
      await response.json().catch(() => null)
    if (!response.ok || data?.success !== true || !Array.isArray(data.rows)) return null
    const mine = data.rows.find((row) => Number(row.userId) === viewerId)
    const rank = mine ? Number(mine.rank) : NaN
    return Number.isFinite(rank) && rank > 0 ? rank : null
  } catch {
    return null
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Phase =
  | { id: 'ident'; error: ScanError | null }
  | { id: 'scan' }
  | { id: 'reveal'; profile: CursorOptInProfile }

/** Count-up formatting per stat cell (driven by data-kind on the span). */
function formatStat(kind: string, value: number): string {
  if (kind === 'tokens') return formatCompactTokenCount(String(Math.max(0, Math.round(value))))
  if (kind === 'streak') return `${formatNumber(Math.max(0, Math.round(value)))}D`
  return formatNumber(Math.max(0, Math.round(value)))
}

export function CursorOptInModal({
  onClose,
  onLinked,
  onViewBoard,
  rankWindow = 'season'
}: {
  onClose: () => void
  /** Fires once the claim lands, so the board can refetch itself. */
  onLinked: (profile: CursorOptInProfile) => void
  /** Success CTA. When absent the CTA just closes (the board is behind). */
  onViewBoard?: () => void
  /** Board window the rank stamp reads — CursorBoard passes its active
   *  window so "ENTERING AT RANK #N" agrees with the visible board. */
  rankWindow?: CursorBoardWindowId
}) {
  const reduced = useReducedMotionLive()
  const [phase, setPhase] = useState<Phase>({ id: 'ident', error: null })
  const [username, setUsername] = useState('')
  const [focused, setFocused] = useState(false)
  const [rank, setRank] = useState<number | null | 'pending'>('pending')
  const [grid, setGrid] = useState<PixelGrid | null>(null)

  const scopeRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const staticRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const barlineRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)
  /** Flipped when the claim resolves and the bar pegs at 100% — the
   *  still-running scan tween's onUpdate must stop writing past it. */
  const barSettledRef = useRef(false)
  const disposedRef = useRef(false)
  const poweredRef = useRef(false)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const live = !reduced

  useEffect(() => {
    disposedRef.current = false
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      disposedRef.current = true
      restoreFocusRef.current?.focus?.()
    }
  }, [])

  // Focus lands on the handle input the moment IDENT is on glass — on
  // open and again on every error bounce-back. Typing never waits for
  // the glitch (the entrance pre-hides with opacity, never visibility,
  // exactly so this focus sticks from the first frame). After the input
  // unmounts into REVEAL, focus moves to the CTA.
  useEffect(() => {
    if (phase.id === 'ident') {
      inputRef.current?.focus()
    } else if (phase.id === 'reveal') {
      ctaRef.current?.focus({ preventScroll: true })
    }
  }, [phase])

  // Body scroll lock for the modal's lifetime — same convention as
  // PlayerCard: the page must not scroll under the overlay.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    // Body-portaled dialogs append in open order, so the last visible
    // [role="dialog"] in the document is the topmost one. Escape and the
    // Tab trap only act when this instance is on top — a stacked settings
    // modal (or a second opt-in) owns its own keys. Dialogs parked under
    // an aria-hidden wrapper (the closed mobile nav drawer) don't count.
    const isTopDialog = () => {
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"]')
      ).filter((el) => el.closest('[aria-hidden="true"]') === null)
      return dialogs.length === 0 || dialogs[dialogs.length - 1] === scopeRef.current
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isTopDialog()) onClose()
        return
      }
      if (event.key !== 'Tab' || !isTopDialog()) return
      const root = scopeRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && root.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = useCallback(async () => {
    const handle = username.trim().replace(/^@+/, '')
    if (!handle) {
      setPhase({
        id: 'ident',
        error: {
          code: 'empty',
          title: 'NO INPUT — HANDLE REQUIRED',
          detail: 'TYPE YOUR CURSOR.COM HANDLE, THEN PRESS ENTER.'
        }
      })
      inputRef.current?.focus()
      return
    }
    if (pendingRef.current) return
    pendingRef.current = true
    barSettledRef.current = false
    setPhase({ id: 'scan' })
    const startedAt = performance.now()
    try {
      const response = await fetch('/api/user/cursor-profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: handle })
      })
      const data: unknown = await response.json().catch(() => null)

      // The scan beat holds ~900ms minimum so the uplink lines land;
      // past that it resolves the moment the API does.
      if (!reducedNow()) {
        const elapsed = performance.now() - startedAt
        if (elapsed < MIN_SCAN_MS) await wait(MIN_SCAN_MS - elapsed)
      }
      if (disposedRef.current) return

      const success =
        typeof data === 'object' &&
        data !== null &&
        (data as { success?: unknown }).success === true
      if (!response.ok || !success) {
        const message =
          typeof data === 'object' &&
          data !== null &&
          typeof (data as { error?: unknown }).error === 'string'
            ? ((data as { error: string }).error)
            : null
        setPhase({ id: 'ident', error: mapScanError(response.status, message) })
        return
      }
      const profile = parseProfile(data)
      if (!profile) {
        setPhase({
          id: 'ident',
          error: {
            code: 'garbled',
            title: 'TRANSMISSION GARBLED — REPLY UNREADABLE',
            detail: 'THE CLAIM MAY HAVE LANDED. REFRESH THE BOARD TO CHECK.'
          }
        })
        return
      }

      // Rank races the reveal choreography; the kicker text updates in
      // place whenever it lands.
      setRank('pending')
      void lookupRank(rankWindow).then((found) => {
        if (!disposedRef.current) setRank(found)
      })

      // Peg the bar at 100% for one beat before the channel switches.
      // barSettledRef stops the scan tween's onUpdate from writing its
      // slower value over the peg while the tween is still running.
      if (!reducedNow() && barRef.current && pctRef.current) {
        barSettledRef.current = true
        barRef.current.textContent = barString(1)
        pctRef.current.textContent = '100%'
        barlineRef.current?.setAttribute('aria-valuenow', '100')
        await wait(BAR_SNAP_MS)
        if (disposedRef.current) return
      }

      setPhase({ id: 'reveal', profile })
      onLinked(profile)
    } catch {
      if (!disposedRef.current) {
        setPhase({ id: 'ident', error: mapScanError(null, null) })
      }
    } finally {
      pendingRef.current = false
    }
  }, [onLinked, rankWindow, username])

  // Avatar → phosphor grid, resolved once the reveal is up. A dead or
  // slow avatar falls back to the deterministic identicon sprite.
  useEffect(() => {
    if (phase.id !== 'reveal') return
    let stale = false
    const profile = phase.profile
    void (async () => {
      const sampled = profile.avatarUrl ? (await imageGrid(profile.avatarUrl)).grid : null
      const resolved = sampled ?? identiconGrid(profile.cursorUsername)
      if (!stale && !disposedRef.current) setGrid(resolved)
    })()
    return () => {
      stale = true
    }
  }, [phase])

  /* ---- GSAP: channel-switch glitch + per-phase choreography ---------- */
  useGSAP(
    () => {
      if (reduced) return
      const scope = scopeRef.current
      const stage = scope?.querySelector<HTMLElement>('.cu-stage')
      if (!scope || !stage) return

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
      // Opacity, never autoAlpha: visibility:hidden would make the handle
      // input unfocusable, and focus must land on the very first frame —
      // typing never waits for the choreography.
      gsap.set(stage, { opacity: 0 })

      // Pre-paint hides so nothing flashes before its beat.
      if (phase.id === 'ident') {
        const beats = stage.querySelectorAll(
          '.cu-headline, .cu-sub, .cu-field, .cu-error, .cu-cta-btn, .cu-foot'
        )
        if (beats.length > 0) gsap.set(beats, { opacity: 0 })
      } else if (phase.id === 'reveal') {
        const beats = stage.querySelectorAll(
          '.cu-rname, .cu-ruser, .cu-stats, .cu-kicker, .cu-cta-btn'
        )
        if (beats.length > 0) gsap.set(beats, { opacity: 0 })
      }

      // One-time power-on: the cabinet pops via CSS; the tube gets a
      // brightness flash here. Channel switches skip it.
      const firstBoot = !poweredRef.current
      if (firstBoot) {
        poweredRef.current = true
        const screen = scope.querySelector('.cu-screen')
        if (screen) {
          tl.fromTo(
            screen,
            { filter: 'brightness(2.2)' },
            { filter: 'brightness(1)', duration: 0.5, ease: 'power2.out' },
            0.05
          )
        }
      }

      // Channel-switch glitch in: static burst, sliced clip reveal.
      tl.addLabel('glitchIn', firstBoot ? 0.12 : 0.02)
      const staticL = staticRef.current
      if (staticL) {
        tl.set(staticL, { opacity: 0.6 }, 'glitchIn')
        tl.to(staticL, { opacity: 0, duration: 0.16, ease: 'power1.in' }, 'glitchIn+=0.08')
      }
      tl.set(
        stage,
        { clipPath: 'inset(46% 0% 46% 0%)', x: -8, opacity: 1 },
        'glitchIn+=0.06'
      )
      tl.to(
        stage,
        {
          keyframes: [
            { clipPath: 'inset(24% 0% 36% 0%)', x: 6, duration: 0.05 },
            { clipPath: 'inset(5% 0% 14% 0%)', x: -4, duration: 0.05 },
            { clipPath: 'inset(0% 0% 0% 0%)', x: 0, duration: 0.08 }
          ],
          ease: 'none'
        },
        'glitchIn+=0.07'
      )

      // Terminal lines type in — sequential, teletype-paced.
      tl.addLabel('type', 'glitchIn+=0.26')
      const typedEls = gsap.utils.toArray<HTMLElement>('.cu-type', stage)
      let at = 0
      for (const el of typedEls) {
        const text = el.dataset.text ?? ''
        el.textContent = ''
        const proxy = { n: 0 }
        const dur = Math.min(0.5, 0.18 + text.length * 0.013)
        tl.to(
          proxy,
          {
            n: text.length,
            duration: dur,
            ease: 'none',
            onUpdate: () => {
              el.textContent = text.slice(0, Math.round(proxy.n))
            }
          },
          `type+=${at.toFixed(3)}`
        )
        at += dur + 0.14
      }

      if (phase.id === 'ident') {
        tl.to('.cu-headline', { opacity: 1, duration: 0.35, ease: 'steps(4)' }, 'type+=0.18')
        tl.to(
          // '.cu-error' only exists on bounce-backs — a dead selector in
          // the target list makes GSAP log dev warnings.
          [
            '.cu-sub',
            '.cu-field',
            ...(phase.error ? ['.cu-error'] : []),
            '.cu-cta-btn',
            '.cu-foot'
          ],
          { opacity: 1, duration: 0.28, stagger: 0.07 },
          'type+=0.34'
        )
        if (phase.error) {
          // Error bounce-backs land with a horizontal jolt on the whole
          // stage — the cabinet took the hit, not just the message.
          tl.fromTo(
            stage,
            { x: -5 },
            { x: 0, duration: 0.4, ease: 'elastic.out(1.2, 0.32)', immediateRender: false },
            'type+=0.3'
          )
        }
      } else if (phase.id === 'scan') {
        const barEl = barRef.current
        const pctEl = pctRef.current
        if (barEl && pctEl) {
          const proxy = { v: 0 }
          tl.to(
            proxy,
            {
              v: 0.92,
              duration: 3.4,
              ease: 'power1.inOut',
              onUpdate: () => {
                // Once the claim resolves, submit() pegs 100% directly —
                // this slower tween must not write over it.
                if (barSettledRef.current) return
                barEl.textContent = barString(proxy.v)
                const pct = Math.round(proxy.v * 100)
                pctEl.textContent = `${String(pct).padStart(3, ' ')}%`
                barlineRef.current?.setAttribute('aria-valuenow', String(pct))
              }
            },
            'type+=0.15'
          )
        }
      } else if (phase.id === 'reveal') {
        tl.to('.cu-rname', { opacity: 1, duration: 0.4, ease: 'steps(5)' }, 'type+=0.12')
        tl.to('.cu-ruser', { opacity: 1, duration: 0.3, ease: 'steps(3)' }, 'type+=0.28')
        tl.to('.cu-stats', { opacity: 1, duration: 0.25 }, 'type+=0.4')

        // Stats count up in pixel numerals, then land on exact strings.
        tl.addLabel('count', 'type+=0.5')
        const statEls = gsap.utils.toArray<HTMLElement>('.cu-statval', stage)
        for (const el of statEls) {
          const target = Number(el.dataset.count ?? '')
          const finalText = el.dataset.final ?? ''
          const kind = el.dataset.kind ?? 'num'
          if (!Number.isFinite(target) || target <= 0) {
            tl.call(
              () => {
                el.textContent = finalText
              },
              undefined,
              'count'
            )
            continue
          }
          const proxy = { v: 0 }
          tl.to(
            proxy,
            {
              v: target,
              duration: 1.0,
              ease: 'power2.out',
              onUpdate: () => {
                el.textContent = formatStat(kind, proxy.v)
              },
              onComplete: () => {
                el.textContent = finalText
              }
            },
            'count'
          )
        }

        // The kicker stamps in oversized and slams to rest, flashing hot.
        tl.fromTo(
          '.cu-kicker',
          { opacity: 0, scale: 1.7 },
          { opacity: 1, scale: 1, duration: 0.26, ease: 'power3.in', immediateRender: false },
          'count+=1.0'
        )
        tl.fromTo(
          '.cu-kicker',
          { filter: 'brightness(2.1)' },
          { filter: 'brightness(1)', duration: 0.45, immediateRender: false },
          'count+=1.26'
        )
        tl.to('.cu-cta-btn', { opacity: 1, duration: 0.3, ease: 'steps(3)' }, 'count+=1.4')
      } else {
        const exhaustive: never = phase
        return exhaustive
      }
    },
    { dependencies: [phase, reduced], scope: scopeRef, revertOnUpdate: true }
  )

  // The avatar grid usually lands after the reveal timeline started —
  // its dither is its own pass, keyed on the grid arriving.
  useGSAP(
    () => {
      if (reduced || phase.id !== 'reveal' || !grid) return
      const cells = gsap.utils.toArray<HTMLElement>('.cu-av-cell', scopeRef.current)
      if (cells.length === 0) return
      gsap.set(cells, { autoAlpha: 0 })
      gsap.to(cells, { autoAlpha: 1, duration: 0.02, stagger: { amount: 0.7, from: 'random' } })
    },
    { dependencies: [grid, phase.id, reduced], scope: scopeRef, revertOnUpdate: true }
  )

  /* ---- render --------------------------------------------------------- */

  const typed = (text: string, className?: string) =>
    live ? (
      <span className={`cu-type${className ? ` ${className}` : ''}`} data-text={text} />
    ) : (
      <span className={className}>{text}</span>
    )

  const gridLines = useMemo(() => (grid ? gridToLines(grid) : null), [grid])

  const handle = username.trim().replace(/^@+/, '')

  const chromeTag = (() => {
    switch (phase.id) {
      case 'ident':
        return 'MODE IDENT'
      case 'scan':
        return 'MODE SCAN'
      case 'reveal':
        return 'LINK OK'
      default: {
        const exhaustive: never = phase
        return exhaustive
      }
    }
  })()

  const ledLabel = (() => {
    switch (phase.id) {
      case 'ident':
        return 'READY'
      case 'scan':
        return 'DIAL'
      case 'reveal':
        return 'LIVE'
      default: {
        const exhaustive: never = phase
        return exhaustive
      }
    }
  })()

  const kickerText =
    rank === 'pending'
      ? 'LOCKING RANK SIGNAL…'
      : rank === null
        ? 'UPLINK LOGGED — YOU ARE ON THE BOARD'
        : `ENTERING AT RANK #${rank}`

  // Portaled to <body>: the leaderboard arena wraps its content in
  // transform/filter CRT treatments, which would trap this fixed overlay
  // in a local stacking context (painting it under the page). z-[80]
  // matches the app's modal layer (EditProfileModal, PremiumWelcomeModal).
  return createPortal(
    <div
      ref={scopeRef}
      className="cu-root fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Join the Cursor burn board"
      data-reduced={reduced || undefined}
    >
      <div className="cu-backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div className="cu-bezel relative w-full max-w-[440px]">
        <div className="cu-screenwrap">
          <div className="cu-screen">
            <div ref={staticRef} className="cu-static" aria-hidden />

            <div className="cu-content">
              <div className="cu-chrome">
                <span>CRIBBLE//UPLINK</span>
                <span className="cu-chrome-right">
                  <span>{chromeTag}</span>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="cu-x"
                  >
                    ✕
                  </button>
                </span>
              </div>

              <div className="cu-stage" key={phase.id}>
                {phase.id === 'ident' && (
                  <form
                    className="cu-ident"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submit()
                    }}
                  >
                    <div className="cu-line1">
                      {typed('> UNREGISTERED PLAYER ON THE WIRE')}
                    </div>

                    <h2 className="cu-headline">NEW CHALLENGER DETECTED</h2>
                    <p className="cu-sub">
                      CLAIM YOUR PUBLIC CURSOR.COM PROFILE AND YOUR BURN GOES UP
                      IN LIGHTS. NO CLI — THE BOARD READS WHAT YOUR PROFILE
                      ALREADY SHOWS.
                    </p>

                    <div
                      className="cu-field"
                      data-focused={focused || undefined}
                      onClick={() => inputRef.current?.focus()}
                    >
                      <span className="cu-prefix" aria-hidden>
                        cursor.com/@
                      </span>
                      <span className="cu-typedval" aria-hidden>
                        {username}
                      </span>
                      <span className="cu-block" aria-hidden>
                        ▮
                      </span>
                      {!username && (
                        <span className="cu-ph" aria-hidden>
                          your-handle
                        </span>
                      )}
                      <input
                        ref={inputRef}
                        className="cu-input"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        aria-label="Your cursor.com handle, without the leading @"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={40}
                        enterKeyHint="go"
                      />
                    </div>

                    {phase.error && (
                      <div role="alert" className="cu-error">
                        <div className="cu-error-title">✖ {phase.error.title}</div>
                        <div className="cu-error-detail">
                          {phase.error.code === 'private' ? (
                            <>
                              SET IT PUBLIC AT{' '}
                              <a
                                href="https://cursor.com/settings"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="cu-error-link"
                              >
                                CURSOR.COM/SETTINGS
                              </a>
                              , THEN DIAL AGAIN.
                            </>
                          ) : (
                            phase.error.detail
                          )}
                        </div>
                      </div>
                    )}

                    <button type="submit" className="cu-cta-btn">
                      ▶ LINK &amp; JOIN THE BOARD
                    </button>

                    <p className="cu-foot">
                      OPT-IN · FIRST CLAIM WINS · UNLINK ANYTIME IN SETTINGS
                    </p>
                  </form>
                )}

                {phase.id === 'scan' && (
                  <div className="cu-scan">
                    <div className="cu-scanline">{typed(`> TARGET LOCKED — @${handle}`)}</div>
                    <div className="cu-scanline">{typed('> DIALING CURSOR.COM…')}</div>
                    <div className="cu-scanline">{typed('> READING PUBLIC PROFILE…')}</div>
                    <div className="cu-scanline">{typed('> COUNTING TOKENS…')}</div>

                    <div
                      ref={barlineRef}
                      className="cu-barline"
                      role="progressbar"
                      aria-label="Uplink progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={live ? 0 : 66}
                    >
                      <span className="cu-label">UPLINK</span>
                      <span className="cu-bracket">[</span>
                      <span ref={barRef} className="cu-barcells">
                        {live ? '·'.repeat(BAR_CELLS) : barString(0.66)}
                      </span>
                      <span className="cu-bracket">]</span>
                      <span ref={pctRef} className="cu-pct">
                        {live ? '  0%' : ' 66%'}
                      </span>
                    </div>

                    <div className="cu-scanhint">
                      <span className="cu-block cu-block-on" aria-hidden>
                        ▮
                      </span>
                      <span>HOLD THE LINE — READING YOUR PROFILE</span>
                    </div>
                  </div>
                )}

                {phase.id === 'reveal' && (
                  <div className="cu-reveal">
                    <div className="cu-line1">
                      {typed('> PLAYER VERIFIED · SIGNAL STRONG')}
                    </div>

                    <div className="cu-av" aria-hidden>
                      {gridLines ? (
                        gridLines.map((line, r) => (
                          <div key={r} className="cu-av-row">
                            {line.map((cell, c) =>
                              cell.ch === ' ' ? (
                                <span key={c}> </span>
                              ) : (
                                <span
                                  key={c}
                                  className="cu-av-cell"
                                  style={{ color: `rgb(var(--cu-p) / ${cell.a})` }}
                                >
                                  {cell.ch}
                                </span>
                              )
                            )}
                          </div>
                        ))
                      ) : (
                        <span className="cu-av-wait">RASTERIZING SPRITE…</span>
                      )}
                    </div>

                    <div className="cu-rname">
                      {phase.profile.displayName || `@${phase.profile.cursorUsername}`}
                    </div>
                    <div className="cu-ruser">
                      @{phase.profile.cursorUsername} · CURSOR.COM
                    </div>

                    <div className="cu-stats">
                      <RevealStat
                        label="TOKENS 30D"
                        kind="tokens"
                        count={exactIntegerToSafeNumber(phase.profile.stats.tokens30d)}
                        final={formatCompactTokenCount(phase.profile.stats.tokens30d)}
                        live={live}
                      />
                      <RevealStat
                        label="AGENTS"
                        kind="num"
                        count={
                          phase.profile.stats.agentsLocal + phase.profile.stats.agentsCloud
                        }
                        final={formatNumber(
                          phase.profile.stats.agentsLocal + phase.profile.stats.agentsCloud
                        )}
                        live={live}
                      />
                      <RevealStat
                        label="STREAK"
                        kind="streak"
                        count={phase.profile.stats.currentStreak}
                        final={`${formatNumber(phase.profile.stats.currentStreak)}D`}
                        live={live}
                      />
                    </div>

                    <div
                      className="cu-kicker"
                      aria-live="polite"
                      data-pending={rank === 'pending' || undefined}
                    >
                      {kickerText}
                    </div>

                    <button
                      ref={ctaRef}
                      type="button"
                      className="cu-cta-btn"
                      onClick={onViewBoard ?? onClose}
                    >
                      ▶ VIEW THE BOARD
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="cu-scanlines" aria-hidden />
            <div className="cu-rollbar" aria-hidden />
            <div className="cu-vignette" aria-hidden />
            <div className="cu-glass" aria-hidden />
          </div>
        </div>

        <div className="cu-chin">
          <span className="cu-brand">CRIBBLE</span>
          <span className="cu-model">MDL UPL·1986 // COIN-UP</span>
          <span className="cu-ledwrap">
            <span className="cu-led" data-mode={phase.id} />
            {ledLabel}
          </span>
        </div>
      </div>

      <style jsx global>{`
        .cu-root {
          /* Ember phosphor — the burn board's orange-400 family, pinned
             locally because the handheld is a physical object: the light
             theme must not tint the tube. */
          --cu-p: 251 146 60;
          --cu-hi: 253 186 116;
          --cu-alarm: 255 110 80;
        }
        .cu-backdrop {
          background: rgb(0 0 0 / 0.72);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: cu-fade-in 220ms ease backwards;
        }

        /* ---- cabinet plastic ---- */
        .cu-bezel {
          border-radius: 22px;
          padding: 12px 12px 0;
          background: linear-gradient(180deg, #34353c, #1c1d23 9%, #15161b 58%, #0e0f13);
          box-shadow:
            inset 0 1px 0 rgb(255 255 255 / 0.1),
            inset 0 -2px 0 rgb(0 0 0 / 0.65),
            inset 2px 0 2px -1px rgb(255 255 255 / 0.04),
            inset -2px 0 2px -1px rgb(0 0 0 / 0.3),
            0 34px 70px -30px rgb(0 0 0 / 0.85),
            0 10px 26px -14px rgb(0 0 0 / 0.6);
          animation: cu-pop 380ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        .cu-screenwrap {
          border-radius: 13px;
          padding: 7px;
          background: linear-gradient(180deg, #060708, #0d0e12 70%, #121318);
          box-shadow:
            inset 0 3px 10px rgb(0 0 0 / 0.9),
            inset 0 -1px 0 rgb(255 255 255 / 0.05);
        }

        /* ---- the glass ---- */
        .cu-screen {
          position: relative;
          overflow: hidden;
          border-radius: 9px;
          background: radial-gradient(
            130% 115% at 50% 40%,
            #1c0e05 0%,
            #100803 55%,
            #080401 100%
          );
          font-family: var(--font-data), ui-monospace, 'SF Mono', Menlo, monospace;
          color: rgb(var(--cu-p) / 0.9);
        }
        .cu-content {
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 13px 20px 18px;
        }
        .cu-chrome {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px dashed rgb(var(--cu-p) / 0.22);
          font-size: 9px;
          letter-spacing: 0.3em;
          color: rgb(var(--cu-p) / 0.55);
          text-shadow: 0 0 5px rgb(var(--cu-p) / 0.35);
        }
        .cu-chrome-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cu-x {
          margin: -6px -6px -6px 0;
          padding: 6px 7px;
          font-size: 10px;
          letter-spacing: 0;
          color: rgb(var(--cu-p) / 0.5);
          transition: color 150ms;
        }
        .cu-x:hover,
        .cu-x:focus-visible {
          color: rgb(var(--cu-hi));
        }

        .cu-stage {
          display: flex;
          flex: 1;
          flex-direction: column;
          min-height: 322px;
          padding-top: 12px;
          text-shadow: 0 0 6px rgb(var(--cu-p) / 0.4);
        }
        .cu-line1 {
          min-height: 14px;
          font-size: 10px;
          letter-spacing: 0.16em;
          color: rgb(var(--cu-p) / 0.75);
        }

        /* ---- IDENT ---- */
        .cu-ident {
          display: flex;
          flex: 1;
          flex-direction: column;
        }
        .cu-headline {
          margin-top: 16px;
          text-align: center;
          font-family: var(--font-pixel);
          font-size: clamp(13px, 4vw, 17px);
          line-height: 1.6;
          color: rgb(var(--cu-hi));
          text-shadow:
            0 0 12px rgb(var(--cu-p) / 0.65),
            0 0 34px rgb(var(--cu-p) / 0.3);
        }
        .cu-sub {
          margin: 12px auto 0;
          max-width: 320px;
          text-align: center;
          font-size: 9px;
          line-height: 1.8;
          letter-spacing: 0.14em;
          color: rgb(var(--cu-p) / 0.55);
        }
        .cu-field {
          position: relative;
          display: flex;
          align-items: center;
          overflow: hidden;
          margin-top: 18px;
          padding: 13px 12px;
          border: 1px solid rgb(var(--cu-p) / 0.3);
          background: rgb(0 0 0 / 0.4);
          cursor: text;
          white-space: pre;
        }
        .cu-field[data-focused] {
          border-color: rgb(var(--cu-p) / 0.65);
          box-shadow:
            0 0 14px rgb(var(--cu-p) / 0.12),
            inset 0 0 10px rgb(var(--cu-p) / 0.05);
        }
        .cu-prefix {
          flex: none;
          font-size: 12px;
          color: rgb(var(--cu-p) / 0.55);
        }
        .cu-typedval {
          overflow: hidden;
          min-width: 0;
          font-size: 13px;
          letter-spacing: 0.06em;
          color: rgb(var(--cu-hi));
          text-shadow: 0 0 8px rgb(var(--cu-p) / 0.5);
        }
        .cu-block {
          flex: none;
          font-size: 12px;
          color: rgb(var(--cu-hi));
          opacity: 0.35;
          text-shadow: 0 0 8px rgb(var(--cu-p) / 0.6);
        }
        .cu-field[data-focused] .cu-block,
        .cu-block-on {
          opacity: 1;
          animation: cu-blink 1.06s steps(2, jump-none) infinite;
        }
        .cu-ph {
          flex: none;
          margin-left: 6px;
          font-size: 12px;
          color: rgb(var(--cu-p) / 0.25);
        }
        .cu-input {
          position: absolute;
          inset: 0;
          width: 100%;
          border: 0;
          background: transparent;
          color: transparent;
          caret-color: transparent;
          /* 16px everywhere: the overlay is invisible, and iOS zooms any
             focused input below 16px regardless of its opacity. */
          font-size: 16px;
          outline: none;
        }
        .cu-error {
          margin-top: 12px;
          padding: 10px 12px;
          border: 1px solid rgb(var(--cu-alarm) / 0.45);
          background: rgb(var(--cu-alarm) / 0.06);
          text-align: left;
        }
        .cu-error-title {
          font-size: 10px;
          letter-spacing: 0.14em;
          color: rgb(var(--cu-alarm));
          text-shadow: 0 0 8px rgb(var(--cu-alarm) / 0.45);
        }
        .cu-error-detail {
          margin-top: 5px;
          font-size: 9px;
          line-height: 1.7;
          letter-spacing: 0.12em;
          color: rgb(var(--cu-alarm) / 0.75);
        }
        .cu-error-link {
          color: rgb(var(--cu-alarm));
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .cu-error-link:hover {
          color: rgb(255 150 120);
        }
        .cu-cta-btn {
          margin-top: 16px;
          width: 100%;
          padding: 13px 12px;
          border: 1px solid rgb(var(--cu-p) / 0.5);
          background: rgb(var(--cu-p) / 0.08);
          font-size: 10px;
          letter-spacing: 0.3em;
          color: rgb(var(--cu-hi));
          text-shadow: 0 0 8px rgb(var(--cu-p) / 0.5);
          transition: background 150ms, box-shadow 150ms;
        }
        .cu-cta-btn:hover,
        .cu-cta-btn:focus-visible {
          background: rgb(var(--cu-p) / 0.16);
          box-shadow: 0 0 18px rgb(var(--cu-p) / 0.15);
        }
        .cu-ident .cu-cta-btn {
          margin-top: 18px;
        }
        .cu-foot {
          /* Anchors the microcopy to the tube's floor so IDENT fills the
             stage's fixed height instead of pooling dead phosphor. */
          margin-top: auto;
          padding-top: 12px;
          text-align: center;
          font-size: 8px;
          letter-spacing: 0.18em;
          /* At 390px the line wraps — balance it so no word sits alone. */
          text-wrap: balance;
          color: rgb(var(--cu-p) / 0.35);
        }

        /* ---- SCAN ---- */
        .cu-scan {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 10px;
          padding-top: 8px;
        }
        .cu-scanline {
          min-height: 14px;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: rgb(var(--cu-p) / 0.85);
        }
        .cu-barline {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-top: 12px;
          font-size: 12px;
          color: rgb(var(--cu-p) / 0.9);
        }
        .cu-label {
          font-size: 8px;
          letter-spacing: 0.3em;
          color: rgb(var(--cu-p) / 0.5);
        }
        .cu-bracket {
          color: rgb(var(--cu-p) / 0.5);
        }
        .cu-barcells {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          letter-spacing: 1px;
          text-shadow: 0 0 6px rgb(var(--cu-p) / 0.5);
        }
        .cu-pct {
          font-size: 10px;
          color: rgb(var(--cu-p) / 0.7);
          white-space: pre;
        }
        .cu-scanhint {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: auto;
          padding-top: 12px;
          border-top: 1px dashed rgb(var(--cu-p) / 0.18);
          font-size: 9px;
          letter-spacing: 0.26em;
          color: rgb(var(--cu-hi) / 0.85);
        }

        /* ---- REVEAL ---- */
        .cu-reveal {
          display: flex;
          flex: 1;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .cu-reveal .cu-line1 {
          align-self: flex-start;
        }
        .cu-av {
          display: flex;
          flex-direction: column;
          justify-content: center;
          margin-top: 12px;
          min-height: 108px;
          font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
          font-size: 6px;
          line-height: 6px;
          letter-spacing: 0;
          text-shadow: 0 0 4px rgb(var(--cu-p) / 0.45);
        }
        .cu-av-row {
          height: 6px;
          white-space: pre;
        }
        .cu-av-wait {
          font-size: 9px;
          letter-spacing: 0.3em;
          color: rgb(var(--cu-p) / 0.4);
          animation: cu-wait-blink 1.4s steps(2, jump-none) infinite;
        }
        .cu-rname {
          overflow: hidden;
          margin-top: 12px;
          max-width: 100%;
          font-family: var(--font-pixel);
          font-size: clamp(13px, 4vw, 17px);
          line-height: 1.4;
          color: rgb(var(--cu-hi));
          text-overflow: ellipsis;
          white-space: nowrap;
          text-shadow:
            0 0 10px rgb(var(--cu-p) / 0.6),
            0 0 30px rgb(var(--cu-p) / 0.28);
        }
        .cu-ruser {
          margin-top: 6px;
          font-size: 10px;
          letter-spacing: 0.2em;
          color: rgb(var(--cu-p) / 0.6);
        }
        .cu-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          margin-top: 14px;
          width: 100%;
          max-width: 330px;
          border: 1px solid rgb(var(--cu-p) / 0.22);
          background: rgb(var(--cu-p) / 0.22);
        }
        .cu-stat {
          padding: 10px 6px 9px;
          background: rgb(12 6 2 / 0.92);
        }
        .cu-statval {
          font-family: var(--font-pixel);
          font-size: 13px;
          color: rgb(var(--cu-p));
          text-shadow: 0 0 10px rgb(var(--cu-p) / 0.5);
          font-variant-numeric: tabular-nums;
        }
        .cu-statlabel {
          margin-top: 6px;
          font-size: 7px;
          letter-spacing: 0.18em;
          color: rgb(var(--cu-p) / 0.45);
        }
        .cu-kicker {
          margin-top: 16px;
          min-height: 20px;
          font-family: var(--font-pixel);
          font-size: clamp(11px, 3.4vw, 14px);
          line-height: 1.45;
          color: rgb(var(--cu-hi));
          text-shadow:
            0 0 12px rgb(var(--cu-p) / 0.7),
            0 0 36px rgb(var(--cu-p) / 0.32);
        }
        .cu-kicker[data-pending] {
          color: rgb(var(--cu-p) / 0.5);
          text-shadow: 0 0 6px rgb(var(--cu-p) / 0.3);
        }
        .cu-reveal .cu-cta-btn {
          margin-top: 18px;
          max-width: 330px;
        }

        /* ---- tube physics overlays ---- */
        .cu-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            repeating-linear-gradient(
              0deg,
              rgb(0 0 0 / 0.3) 0px,
              rgb(0 0 0 / 0.3) 1px,
              transparent 1px,
              transparent 3px
            ),
            repeating-linear-gradient(
              90deg,
              rgb(0 0 0 / 0.07) 0px,
              rgb(0 0 0 / 0.07) 1px,
              transparent 1px,
              transparent 3px
            );
        }
        .cu-rollbar {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          height: 14%;
          pointer-events: none;
          background: linear-gradient(
            180deg,
            transparent,
            rgb(var(--cu-p) / 0.05) 40%,
            rgb(255 255 255 / 0.05) 55%,
            transparent
          );
          transform: translateY(-120%);
          will-change: transform;
          animation: cu-roll 7.4s linear infinite;
        }
        .cu-static {
          position: absolute;
          inset: -96px 0 0 -160px;
          pointer-events: none;
          opacity: 0;
          background-color: #0a0502;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 160px 160px;
          filter: grayscale(1) brightness(0.68) sepia(1) saturate(3.2)
            hue-rotate(-24deg);
          will-change: transform;
          animation: cu-static-crawl 0.42s steps(5) infinite;
        }
        .cu-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          background: radial-gradient(
            118% 102% at 50% 50%,
            transparent 56%,
            rgb(0 0 0 / 0.3) 78%,
            rgb(0 0 0 / 0.66) 100%
          );
          box-shadow:
            inset 0 0 60px 12px rgb(0 0 0 / 0.6),
            inset 0 0 8px 2px rgb(0 0 0 / 0.65);
        }
        .cu-glass {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(
              112deg,
              rgb(255 255 255 / 0.07) 0%,
              rgb(255 255 255 / 0.02) 18%,
              transparent 34%
            ),
            radial-gradient(
              58% 28% at 24% 5%,
              rgb(255 255 255 / 0.08),
              transparent 70%
            );
        }

        /* ---- chin: brand plate + link LED ---- */
        .cu-chin {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 9px 14px;
        }
        .cu-brand {
          font-family: var(--font-pixel);
          font-size: 9px;
          letter-spacing: 0.1em;
          color: rgb(255 255 255 / 0.42);
        }
        .cu-model {
          overflow: hidden;
          font-family: var(--font-data), ui-monospace, Menlo, monospace;
          font-size: 7px;
          letter-spacing: 0.3em;
          color: rgb(255 255 255 / 0.2);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cu-ledwrap {
          display: flex;
          flex: none;
          align-items: center;
          gap: 6px;
          font-family: var(--font-data), ui-monospace, Menlo, monospace;
          font-size: 8px;
          letter-spacing: 0.26em;
          color: rgb(255 255 255 / 0.35);
        }
        .cu-led {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgb(var(--cu-p));
          box-shadow: 0 0 9px rgb(var(--cu-p) / 0.9);
        }
        .cu-led[data-mode='scan'] {
          animation: cu-led-dial 0.6s steps(2, jump-none) infinite;
        }

        /* ---- keyframes ---- */
        @keyframes cu-fade-in {
          from { opacity: 0; }
        }
        @keyframes cu-pop {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
        }
        @keyframes cu-blink {
          50% { opacity: 0; }
        }
        @keyframes cu-wait-blink {
          50% { opacity: 0.35; }
        }
        @keyframes cu-roll {
          to { transform: translateY(760%); }
        }
        @keyframes cu-static-crawl {
          to { transform: translate3d(160px, 96px, 0); }
        }
        @keyframes cu-led-dial {
          50% { opacity: 0.25; }
        }

        /* ---- small screens ---- */
        @media (max-width: 480px) {
          .cu-bezel {
            border-radius: 18px;
            padding: 10px 10px 0;
          }
          .cu-screenwrap {
            border-radius: 11px;
            padding: 5px;
          }
          .cu-content {
            padding: 12px 14px 16px;
          }
          .cu-stage {
            min-height: 300px;
          }
          .cu-sub {
            max-width: 290px;
          }
          .cu-av {
            font-size: 5px;
            line-height: 5px;
            min-height: 90px;
          }
          .cu-av-row {
            height: 5px;
          }
          .cu-statval {
            font-size: 12px;
          }
          .cu-model {
            display: none;
          }
        }

        /* Reduced motion (or the in-app kill switch): every loop on the
           handheld parks — phases render as still frames. */
        .cu-root[data-reduced='true'] .cu-backdrop,
        .cu-root[data-reduced='true'] .cu-bezel,
        .cu-root[data-reduced='true'] .cu-block,
        .cu-root[data-reduced='true'] .cu-block-on,
        .cu-root[data-reduced='true'] .cu-av-wait,
        .cu-root[data-reduced='true'] .cu-rollbar,
        .cu-root[data-reduced='true'] .cu-static,
        .cu-root[data-reduced='true'] .cu-led {
          animation: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .cu-backdrop,
          .cu-bezel,
          .cu-block,
          .cu-block-on,
          .cu-av-wait,
          .cu-rollbar,
          .cu-static,
          .cu-led {
            animation: none;
          }
        }
      `}</style>
    </div>,
    document.body
  )
}

function RevealStat({
  label,
  kind,
  count,
  final,
  live
}: {
  label: string
  kind: 'tokens' | 'num' | 'streak'
  /** Numeric count-up target; null when the exact value overflows. */
  count: number | null
  final: string
  live: boolean
}) {
  return (
    <div className="cu-stat">
      <div
        className="cu-statval"
        data-kind={kind}
        data-count={count ?? ''}
        data-final={final}
      >
        {live ? formatStat(kind, 0) : final}
      </div>
      <div className="cu-statlabel">{label}</div>
    </div>
  )
}
