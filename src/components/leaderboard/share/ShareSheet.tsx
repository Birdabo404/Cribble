'use client'

// Share overlay — opens above a profile modal (z-[80] over the modal's
// z-[70]) with a live, pointer-tilted preview of the ShareCard and three
// delivery actions: POST ON X, COPY 4K, DOWNLOAD 4K. The preview IS the
// capture target: html-to-image reads layout size (1080x1350), so the
// fit-to-screen scale lives on a wrapper while the card node itself stays
// untransformed. Deliberately a darkroom in both themes — the card is
// pinned to the dark palette, so the sheet develops it on black.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatNumber, formatScore } from '@/components/dashboard-v2/format'
import { IconClose, SocialIcon } from '@/components/leaderboard/icons'
import { prefersReducedMotion } from '@/lib/motion'
import {
  canShareFiles,
  captureElementToBlob,
  copyBlobToClipboard,
  downloadBlob,
  openXIntent,
  shareFiles,
  sharePixelRatio
} from './capture'
import {
  ShareCard,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  type ShareCardData,
  type ShareCardVariant
} from './ShareCard'

const CLOSE_MS = 200
const READY_DEADLINE_MS = 6000
const LIME = 'rgb(252 255 0)'
const INK = '#05060a'

/** Tweet copy for the captured card — tone matches ReferralPlate's
 *  inviteText: lowercase "cribble", confident, no hashtags, no emojis. */
export function shareTweetText(opts: {
  variant: ShareCardVariant
  isOwn: boolean
  username: string
  rank: number
  score: number
  link: string
}): string {
  const { variant, isOwn, username, rank, score, link } = opts
  switch (variant) {
    case 'medal':
      return isOwn
        ? `rank #${rank} on cribble — the live leaderboard for AI coding hours. ${formatNumber(score)} pts and climbing. think you can outrank me?\n\n${link}`
        : `@${username} is sitting at rank #${rank} on cribble, the AI coding leaderboard. come watch the board — or get on it:\n\n${link}`
    case 'ember':
      return isOwn
        ? `rank #${rank} on cribble's burn board — ${formatScore(score)} tokens torched and counting. think you can outburn me?\n\n${link}`
        : `@${username} is torching tokens at rank #${rank} on cribble's burn board. come watch the burn — or join it:\n\n${link}`
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

const shareFilename = (username: string, rank: number, ext: 'png' | 'jpg') =>
  `cribble-card-@${username.replace(/[^A-Za-z0-9._-]/g, '')}-rank${rank}.${ext}`

// Desktop Chromium on macOS/Windows answers canShare({files}) with true,
// but navigator.share there opens the OS share sheet (AirDrop/Mail — no X
// target), which is strictly worse than the clipboard + intent flow. The
// native-share path is therefore reserved for touch-primary devices.
const prefersNativeShare = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface ReferralInfo {
  link: string
  code: string
}

type BusyAction = 'post' | 'copy' | 'download' | null

export function ShareSheet({
  data,
  variant,
  isYou,
  signedIn,
  onClose
}: {
  data: ShareCardData
  variant: ShareCardVariant
  isYou: boolean
  signedIn: boolean
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) onCloseRef.current()
    else setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => onCloseRef.current(), CLOSE_MS)
    return () => clearTimeout(t)
  }, [closing])

  // Escape is intercepted in the CAPTURE phase and stopped there — the
  // parent profile modal listens for Escape on window too (bubble phase,
  // registered earlier), and one keypress must not close both layers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      requestClose()
    }
    window.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [requestClose])

  // ---- referral prefetch (same pattern as ReferralPlate) --------------
  const [referral, setReferral] = useState<ReferralInfo | null>(null)
  const [referralSettled, setReferralSettled] = useState(() => !signedIn)

  useEffect(() => {
    if (!signedIn) {
      setReferralSettled(true)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    fetch('/api/user/referral', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('referral fetch failed'))))
      .then((d) => {
        if (typeof d?.link === 'string' && typeof d?.code === 'string') {
          setReferral({ link: d.link, code: d.code })
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer)
        setReferralSettled(true)
      })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [signedIn])

  // ---- fit-to-screen preview sizing -------------------------------------
  // The preview width is derived from live measurements — panel width and
  // (visual viewport minus the sheet's actual chrome height) — instead of a
  // hardcoded reserve, so the card maximizes itself while the header,
  // status line, and actions are guaranteed to fit without scrolling on
  // any phone height or orientation.
  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [previewW, setPreviewW] = useState<number | null>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const compute = () => {
      const panel = panelRef.current
      if (!panel) return
      const chrome =
        (headerRef.current?.offsetHeight ?? 0) + (controlsRef.current?.offsetHeight ?? 0)
      const viewportH = window.visualViewport?.height ?? window.innerHeight
      // 56 covers the root padding plus a small guard band
      const availH = viewportH - chrome - 56
      const idealW = (availH * SHARE_CARD_WIDTH) / SHARE_CARD_HEIGHT
      setPreviewW(Math.max(180, Math.min(panel.clientWidth, idealW)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (panelRef.current) ro.observe(panelRef.current)
    window.addEventListener('resize', compute)
    window.visualViewport?.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', compute)
      window.visualViewport?.removeEventListener('resize', compute)
    }
  }, [])

  // Scale tracks the frame's realized width (previewW, minus any clamping
  // the layout applies), keeping the capture target itself untransformed.
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / SHARE_CARD_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- capture readiness ------------------------------------------------
  // The QR chip lands async (QRCode.toDataURL into state) and the avatar
  // walks an onError fallback chain through the card proxy, so the sheet
  // holds the actions until fonts are loaded and every <img> in the card
  // has settled. Fails open at the deadline: a missing avatar degrades to
  // the monogram, never to a locked sheet.
  const [ready, setReady] = useState(false)
  const expectQr = referral !== null

  useEffect(() => {
    if (!referralSettled) {
      setReady(false)
      return
    }
    let cancelled = false
    setReady(false)
    const settle = async () => {
      await document.fonts.ready
      const deadline = Date.now() + READY_DEADLINE_MS
      while (!cancelled && Date.now() < deadline) {
        const el = cardRef.current
        if (el) {
          const imgs = Array.from(el.querySelectorAll('img'))
          const imgsSettled = imgs.every((img) => img.complete)
          const qrSettled = !expectQr || imgs.some((img) => img.src.startsWith('data:image'))
          if (imgsSettled && qrSettled) {
            await sleep(180)
            if (!cancelled) setReady(true)
            return
          }
        }
        await sleep(120)
      }
      if (!cancelled) setReady(true)
    }
    void settle()
    return () => {
      cancelled = true
    }
  }, [referralSettled, expectQr])

  // ---- pointer tilt (same treatment as the profile modals) -------------
  const tiltRef = useRef<HTMLDivElement>(null)
  const pointerPos = useRef<{ x: number; y: number } | null>(null)
  const tiltRaf = useRef(0)

  const onTiltMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    pointerPos.current = { x: e.clientX, y: e.clientY }
    if (tiltRaf.current) return
    tiltRaf.current = requestAnimationFrame(() => {
      tiltRaf.current = 0
      const el = tiltRef.current
      const p = pointerPos.current
      if (!el || !p || prefersReducedMotion()) return
      const r = el.getBoundingClientRect()
      const x = (p.x - r.left) / r.width
      const y = (p.y - r.top) / r.height
      el.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`)
      el.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`)
    })
  }, [])

  const onTiltLeave = useCallback(() => {
    if (tiltRaf.current) {
      cancelAnimationFrame(tiltRaf.current)
      tiltRaf.current = 0
    }
    const el = tiltRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }, [])

  useEffect(
    () => () => {
      if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current)
    },
    []
  )

  // ---- capture actions ---------------------------------------------------
  const busyRef = useRef(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [status, setStatus] = useState<string | null>(null)
  const statusTimer = useRef(0)

  const showStatus = useCallback((text: string, transientMs?: number) => {
    window.clearTimeout(statusTimer.current)
    setStatus(text)
    if (transientMs) {
      statusTimer.current = window.setTimeout(() => setStatus(null), transientMs)
    }
  }, [])

  useEffect(() => () => window.clearTimeout(statusTimer.current), [])

  const [shutterTick, setShutterTick] = useState(0)
  const [pulsing, setPulsing] = useState(false)
  const pulseTimer = useRef(0)

  const fireShutter = useCallback(() => {
    if (prefersReducedMotion()) return
    setShutterTick((t) => t + 1)
    setPulsing(true)
    window.clearTimeout(pulseTimer.current)
    pulseTimer.current = window.setTimeout(() => setPulsing(false), 480)
  }, [])

  useEffect(() => () => window.clearTimeout(pulseTimer.current), [])

  const captureCard = useCallback((type: 'image/png' | 'image/jpeg', quality?: number) => {
    const el = cardRef.current
    if (!el) return Promise.reject(new Error('Card not mounted'))
    return captureElementToBlob(el, { pixelRatio: sharePixelRatio(), type, quality })
  }, [])

  const beginAction = useCallback(
    (action: Exclude<BusyAction, null>) => {
      if (busyRef.current || !ready) return false
      busyRef.current = true
      setBusy(action)
      fireShutter()
      return true
    },
    [ready, fireShutter]
  )

  const endAction = useCallback(() => {
    busyRef.current = false
    setBusy(null)
  }, [])

  const tweetText = useCallback(() => {
    const link = referral?.link ?? `${window.location.origin}/leaderboard`
    return shareTweetText({
      variant,
      isOwn: isYou,
      username: data.username,
      rank: data.rank,
      score: data.score,
      link
    })
  }, [referral, variant, isYou, data.username, data.rank, data.score])

  const handlePost = useCallback(async () => {
    if (!beginAction('post')) return
    try {
      const text = tweetText()
      // Path decided up front with a type-only probe file, so the desktop
      // flow never pays for the JPEG capture it would just throw away.
      const probe = new File([new Blob([], { type: 'image/jpeg' })], 'card.jpg', {
        type: 'image/jpeg'
      })
      if (prefersNativeShare() && canShareFiles(probe)) {
        const jpeg = await captureCard('image/jpeg', 0.92)
        const file = new File([jpeg], shareFilename(data.username, data.rank, 'jpg'), {
          type: 'image/jpeg'
        })
        const shared = await shareFiles({ file, text })
        showStatus(shared ? 'CARD HANDED TO YOUR SHARE SHEET' : 'SHARE DISMISSED', 2600)
      } else {
        const png = await captureCard('image/png')
        const copied = await copyBlobToClipboard(png)
        if (copied) {
          openXIntent(text)
          showStatus('4K CARD COPIED — PASTE IT INTO YOUR POST')
        } else {
          downloadBlob(png, shareFilename(data.username, data.rank, 'png'))
          openXIntent(text)
          showStatus('CARD DOWNLOADED — ATTACH IT TO YOUR POST')
        }
      }
    } catch {
      showStatus('CAPTURE FAILED — TRY AGAIN', 3200)
    } finally {
      endAction()
    }
  }, [beginAction, endAction, tweetText, captureCard, data.username, data.rank, showStatus])

  const handleCopy = useCallback(async () => {
    if (!beginAction('copy')) return
    try {
      const png = await captureCard('image/png')
      const copied = await copyBlobToClipboard(png)
      if (copied) {
        showStatus('COPIED', 2000)
      } else {
        downloadBlob(png, shareFilename(data.username, data.rank, 'png'))
        showStatus('CLIPBOARD UNAVAILABLE — CARD DOWNLOADED', 3200)
      }
    } catch {
      showStatus('CAPTURE FAILED — TRY AGAIN', 3200)
    } finally {
      endAction()
    }
  }, [beginAction, endAction, captureCard, data.username, data.rank, showStatus])

  const handleDownload = useCallback(async () => {
    if (!beginAction('download')) return
    try {
      const png = await captureCard('image/png')
      downloadBlob(png, shareFilename(data.username, data.rank, 'png'))
      showStatus('CARD SAVED', 2200)
    } catch {
      showStatus('CAPTURE FAILED — TRY AGAIN', 3200)
    } finally {
      endAction()
    }
  }, [beginAction, endAction, captureCard, data.username, data.rank, showStatus])

  if (typeof document === 'undefined') return null

  const actionsDisabled = !ready || busy !== null
  const printW = sharePixelRatio() * SHARE_CARD_WIDTH
  const printH = sharePixelRatio() * SHARE_CARD_HEIGHT

  const secondaryButtonClass =
    'flex h-12 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-[11px] tracking-[0.25em] text-zinc-300 transition-colors hover:border-white/[0.3] hover:text-zinc-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:h-11'

  return createPortal(
    <div
      className="shs-root fixed inset-0 z-[80] flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] font-mono sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Share card — @${data.username}`}
      data-closing={closing ? '' : undefined}
    >
      <div className="shs-backdrop absolute inset-0" onClick={requestClose} aria-hidden />

      <div ref={panelRef} className="shs-panel relative flex max-h-full w-full max-w-[420px] flex-col">
        {/* ---------- header ---------- */}
        <div ref={headerRef} className="flex items-center justify-between pb-3">
          <span className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: LIME, boxShadow: `0 0 8px ${LIME}` }}
            />
            <span className="text-[10px] tracking-[0.4em] text-zinc-300">SHARE CARD</span>
          </span>
          <button
            type="button"
            onClick={requestClose}
            autoFocus
            aria-label="Close share sheet"
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-zinc-50 sm:h-8 sm:w-8"
            style={{ background: 'rgb(0 0 0 / 0.55)', border: '1px solid rgb(255 255 255 / 0.14)' }}
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* ---------- live preview ---------- */}
        <div
          ref={frameRef}
          className="shs-tilt relative mx-auto w-full max-w-full"
          style={previewW !== null ? { width: previewW } : undefined}
          onPointerMove={onTiltMove}
          onPointerLeave={onTiltLeave}
        >
          <div ref={tiltRef} className="shs-tilt-inner">
            <div className={pulsing ? 'shs-pulse' : undefined}>
              <div
                className="relative w-full overflow-hidden rounded-2xl"
                style={{
                  aspectRatio: '4 / 5',
                  border: '1px solid rgb(255 255 255 / 0.14)',
                  boxShadow: '0 30px 90px -30px rgb(0 0 0 / 0.9)'
                }}
              >
                <div
                  style={{
                    width: SHARE_CARD_WIDTH,
                    height: SHARE_CARD_HEIGHT,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left'
                  }}
                >
                  {/* untransformed capture target — html-to-image reads this
                      node's layout size, not the wrapper's scale */}
                  <div ref={cardRef} style={{ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }}>
                    <ShareCard
                      data={data}
                      variant={variant}
                      inviteLink={referral?.link ?? null}
                      inviteCode={referral?.code ?? null}
                    />
                  </div>
                </div>
                {shutterTick > 0 && (
                  <span key={shutterTick} aria-hidden className="shs-flash absolute inset-0 z-20" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ---------- status + actions (measured as one chrome block) ---------- */}
        <div ref={controlsRef}>
          <div
            className="flex h-10 items-center justify-center px-2 text-center"
            aria-live="polite"
          >
            {status ? (
              <span className="text-[10px] tracking-[0.2em] text-zinc-200">{status}</span>
            ) : ready ? (
              <span className="text-[10px] tracking-[0.25em] text-zinc-600">
                READY · {printW}×{printH} PRINT
              </span>
            ) : (
              <span className="shs-develop text-[10px] tracking-[0.25em] text-zinc-500">
                DEVELOPING…
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePost}
              disabled={actionsDisabled}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[11px] font-bold tracking-[0.25em] transition-[transform,box-shadow,filter] hover:brightness-105 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40 sm:h-11"
              style={{
                background: LIME,
                color: INK,
                boxShadow: '0 0 24px -8px rgb(252 255 0 / 0.6)'
              }}
            >
              <SocialIcon kind="x" size={11} />
              {busy === 'post' ? 'CAPTURING…' : 'POST ON X'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={actionsDisabled}
                className={secondaryButtonClass}
              >
                {busy === 'copy' ? 'COPYING…' : 'COPY 4K'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={actionsDisabled}
                className={secondaryButtonClass}
              >
                {busy === 'download' ? 'SAVING…' : 'DOWNLOAD 4K'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        /* Darkroom in both themes — the card is pinned to the dark palette,
           so the sheet develops it on black rather than a light veil. */
        .shs-backdrop {
          background: rgb(0 0 0 / 0.86);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          animation: shs-backdrop-in 240ms ease backwards;
        }
        @keyframes shs-backdrop-in {
          from {
            opacity: 0;
          }
        }

        .shs-panel {
          animation: shs-panel-in 400ms cubic-bezier(0.26, 1.35, 0.45, 1) backwards;
        }
        @keyframes shs-panel-in {
          from {
            opacity: 0;
            transform: scale(0.88) translateY(26px);
          }
        }

        .shs-root[data-closing] {
          pointer-events: none;
        }
        .shs-root[data-closing] .shs-backdrop {
          animation: shs-backdrop-out ${CLOSE_MS}ms ease forwards;
        }
        .shs-root[data-closing] .shs-panel {
          animation: shs-panel-out ${CLOSE_MS}ms cubic-bezier(0.5, 0, 0.75, 0.4) forwards;
        }
        @keyframes shs-backdrop-out {
          to {
            opacity: 0;
          }
        }
        @keyframes shs-panel-out {
          to {
            opacity: 0;
            transform: scale(0.94) translateY(14px);
          }
        }

        .shs-tilt-inner {
          transform: perspective(1100px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
          transition: transform 220ms ease-out;
          will-change: transform;
        }

        /* shutter: white flash over the preview + a quick settle pulse */
        .shs-flash {
          background: #fff;
          animation: shs-flash-fire 420ms ease-out forwards;
        }
        @keyframes shs-flash-fire {
          0% {
            opacity: 0;
          }
          12% {
            opacity: 0.95;
          }
          100% {
            opacity: 0;
          }
        }
        .shs-pulse {
          animation: shs-pulse-snap 420ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes shs-pulse-snap {
          0% {
            transform: scale(1);
          }
          30% {
            transform: scale(0.977);
          }
          100% {
            transform: scale(1);
          }
        }

        .shs-develop {
          animation: shs-develop-breathe 1.4s ease-in-out infinite;
        }
        @keyframes shs-develop-breathe {
          0%,
          100% {
            opacity: 0.45;
          }
          50% {
            opacity: 1;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .shs-backdrop,
          .shs-panel,
          .shs-flash,
          .shs-pulse,
          .shs-develop {
            animation: none;
          }
          .shs-tilt-inner {
            transform: none;
            transition: none;
            will-change: auto;
          }
        }
      `}</style>
    </div>,
    document.body
  )
}
