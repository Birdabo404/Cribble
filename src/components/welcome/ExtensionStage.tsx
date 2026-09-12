'use client'

// The browser lane's setup stage: INSTALL → LINK → PIN → FIRST SIGNAL, one
// card per phase with the active one expanded, under a four-segment rail.
// The phase is derived (extensionPhase.ts) from what the extension reports
// through the handshake — detected, then registered + tokened + bound to
// this account — never from the user claiming a step. PIN is the one
// acknowledged phase, because no handshake can see a toolbar.
//
// What used to be a dead end ("WAITING FOR INSTALL…" plus a grey RELOAD
// button) is now handled by the stage itself: a store visit is remembered,
// and coming back to this tab after a long enough absence with nothing
// detected triggers one silent reconnect (persist, reload, resume with the
// intro skipped). Detection then leads straight into registration here on
// /welcome, so "onboarded" finally means "linked".
//
// Motion: GSAP owns the rail, the phase-card swaps and the points count-up;
// the wire (HandshakeWire) and the lesson (ToolbarLesson) own their own
// loops. anime.js types the status pill, the same texture split the AI
// board uses. Everything consults welcomeMotionReduced() and rests on its
// final frame when motion is off.

import { useCallback, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { animate, splitText, stagger, steps } from 'animejs'
import { registerDeviceWithBackend } from '@/lib/client/deviceRegistration'
import {
  notifyDeviceRegistered,
  subscribeExtensionMessages,
  type ExtensionIdentity
} from '@/lib/extensionBridge'
import {
  installableBrowserNames,
  type ChromiumForkName,
  type ExtensionBrowserFamily
} from '@/lib/extensionInstall'
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconPuzzle
} from '@/components/welcome/icons'
import {
  CardIcon,
  MarkDoneButton,
  PhaseCard,
  PrimaryButton,
  StageActions,
  StageShell
} from '@/components/welcome/shared'
import {
  CRIBBLE_EASE,
  welcomeMotionReduced
} from '@/components/welcome/welcomeMotion'
import {
  deriveExtensionPhase,
  isLinked,
  type ExtensionPhase
} from '@/components/welcome/extensionPhase'
import {
  EXTENSION_STORES,
  signalSurfaces,
  storeSublabel,
  type ExtensionStore
} from '@/components/welcome/extensionStores'
import {
  HandshakeWire,
  type HandshakeWireState
} from '@/components/welcome/HandshakeWire'
import { ToolbarLesson } from '@/components/welcome/ToolbarLesson'
import type { ExtensionProgressSnapshot } from '@/components/welcome/welcomeProgress'

const PHASES: { id: ExtensionPhase; label: string }[] = [
  { id: 'install', label: 'INSTALL' },
  { id: 'link', label: 'LINK' },
  { id: 'pin', label: 'PIN' },
  { id: 'signal', label: 'FIRST SIGNAL' }
]

const PHASE_INDEX: Record<ExtensionPhase, number> = {
  install: 0,
  link: 1,
  pin: 2,
  signal: 3
}

/** Away time (last `hidden` → back) before a return counts as "back from
 *  the store". A glance at the listing and back never reaches it. */
const AUTO_RECONNECT_AWAY_MS = 8_000

/** RECONNECTING is shown for this beat before the reload, long enough to
 *  read as a state change instead of a flicker. */
const RECONNECT_BEAT_MS = 400

/** Dwell on EXTENSION DETECTED before the cards swap to LINK, so the
 *  ladder's rung is read and the check has popped. Registration itself
 *  starts the moment detection lands — this holds the picture, not the
 *  work. */
const DETECTED_DWELL_MS = 700

/** The wire's SYN / SYN·ACK / ACK volley runs to 1.8s; LINKED waits it out
 *  so a fast registration never cuts the handshake short. */
const MIN_LINKING_MS = 2_100

/** Dwell on the solid wire reading LINKED before the cards move on to
 *  PIN — the rung a first-run user is here to see. */
const LINKED_DWELL_MS = 900

/** After a successful registration the extension stores its token
 *  asynchronously. Ask it again this often, this many times — never
 *  re-posting, since every POST rotates the token. */
const LINK_RECHECK_MS = 1_200
const LINK_RECHECKS = 3

/** Dwell on LINKED before a previously linked user is forwarded. */
const LINKED_PAUSE_MS = 900

/** Floor between two focus-triggered handshakes while listening. */
const FOCUS_REFRESH_GAP_MS = 2_000

/** The points count-up, and the typewriter's total budget per status. */
const COUNT_UP_S = 0.6
const TYPE_BUDGET_MS = 200

type FirstSignal =
  | { kind: 'points'; points: number; domain: string }
  | { kind: 'queued'; count: number }

export interface ExtensionStageProps {
  step: number
  /** Numeric owner id from the onboarding GET — what /api/extension/sync
   *  binds the device to. Null until the status lands, and null for good
   *  if the GET failed. */
  userId: number | null
  /** True once the onboarding GET settled, whatever it returned. With
   *  userId still null after that, this page can't verify the link. */
  statusKnown: boolean
  /** The latest handshake answer, from the page's detection hook. */
  identity: ExtensionIdentity | null
  detected: boolean
  /** True once the first handshake attempt settled, whatever it found. */
  checked: boolean
  /** One more handshake on demand (after registration, on tab focus). A
   *  null answer un-detects and hands the search back to the poll loop. */
  refresh: () => Promise<ExtensionIdentity | null>
  capableBrowser: boolean
  /** Store card to highlight — null (Safari, mobile, SSR) highlights
   *  none. Cosmetic only: every card stays a plain link either way. */
  browserFamily: ExtensionBrowserFamily | null
  /** The running Chromium fork, for the Chrome card's sublabel only. */
  forkName: ChromiumForkName | null
  /** Onboarded before AND the account linked a device before: this user
   *  skips the lesson and is forwarded shortly after LINKED. */
  alreadyLinked: boolean
  /** False on the 'both' lane, where the agent-link stage still follows. */
  finalStep: boolean
  /** The loadout — seeds the FIRST SIGNAL grid. */
  topTools: string[]
  progress: ExtensionProgressSnapshot
  /** Partial update; the page merges and persists it. */
  onProgress: (patch: Partial<ExtensionProgressSnapshot>) => void
  /** verdict === 'allow' && (!capableBrowser || linked), computed by the
   *  page so the wall and the gate can never disagree. */
  canEnter: boolean
  onDone: () => void
  /** Persists progress with fastResume + autoReconnects bumped, then
   *  reloads. Session resume lands right back here with no intro. */
  onReconnect: () => void
  /** Dev only: force a phase for the jumper. Null lets the machine run. */
  devPhaseOverride?: ExtensionPhase | null
  /** Dev only: its presence renders the phase jumper row. */
  onDevPhaseOverride?: (phase: ExtensionPhase | null) => void
}

export function ExtensionStage({
  step,
  userId,
  statusKnown,
  identity,
  detected,
  checked,
  refresh,
  capableBrowser,
  browserFamily,
  forkName,
  alreadyLinked,
  finalStep,
  topTools,
  progress,
  onProgress,
  canEnter,
  onDone,
  onReconnect,
  devPhaseOverride = null,
  onDevPhaseOverride
}: ExtensionStageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pointsRef = useRef<HTMLSpanElement>(null)
  // Last time this tab went hidden — the auto-reconnect measures its away
  // time from here, so only a real absence counts.
  const hiddenAtRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  // Device uuids a registration POST has been sent for this mount. One
  // POST per device, ever, unless the user asks for a retry: every POST
  // rotates the sync token server-side, and re-posting on each identity
  // refresh would invalidate the token the extension just stored (the
  // same loop useExtensionSync's userIdRef guards against).
  const registeredUuidsRef = useRef<Set<string>>(new Set())
  // Component-level, not per effect run: StrictMode's remount and a dep
  // change mid-POST both re-run the registration effect, and the rerun
  // bails on the uuid set — so the run that posted stays the owner and
  // must still land its result. Only a real unmount stands it down.
  const unmountedRef = useRef(false)
  // Whether this mount ever needed to link (the raw phase touched LINK),
  // and when the volley started showing — the minimum hold runs from
  // there, not from when registration began behind the INSTALL dwell.
  const sawLinkRef = useRef(false)
  const linkingSinceRef = useRef<number | null>(null)
  // The push handler reads the latest identity without re-subscribing.
  const identityRef = useRef(identity)
  const lastFocusRefreshRef = useRef(0)
  const lastShownRef = useRef<ExtensionPhase | null>(null)

  const [reconnecting, setReconnecting] = useState(false)
  const [linkFailed, setLinkFailed] = useState(false)
  const [linkAttempt, setLinkAttempt] = useState(0)
  // False for a beat after detection, while INSTALL shows its check.
  // Seeded from `detected` so a mount that already sees the extension
  // opens on that check instead of flashing the LINK body for a frame
  // and pulling it back.
  const [detectedDwellOver, setDetectedDwellOver] = useState(!detected)
  // The LINK card's display hold: 'volley' while the SYN / SYN·ACK / ACK
  // plays out, 'linked' while the solid wire is read, 'released' once the
  // cards may move on.
  const [linkHold, setLinkHold] = useState<'volley' | 'linked' | 'released'>(
    'released'
  )
  const [signal, setSignal] = useState<FirstSignal | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    identityRef.current = identity
  }, [identity])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const linked = isLinked(identity, userId)
  // The onboarding GET settled without an id (5xx, network): nothing on
  // this page can bind or verify the device. The page fails open on
  // detected, the same call ExtensionGate makes, and the dashboard's
  // useExtensionSync registers the device on arrival — so the LINK card
  // says so instead of spinning.
  const linkUnverified = statusKnown && userId === null
  const rawPhase =
    devPhaseOverride ??
    deriveExtensionPhase({
      detected,
      identity,
      userId,
      pinAcknowledged: progress.pinAcknowledged
    })

  // A returning user who linked before parks on LINK reading LINKED and
  // is forwarded from there — the lesson is for first-timers.
  const returning = alreadyLinked && linked && devPhaseOverride === null

  // What the cards show. Two display gates sit between the derived phase
  // and the picture: the INSTALL dwell (EXTENSION DETECTED gets read) and
  // the LINK hold (the volley finishes, LINKED is read). Neither delays
  // the work.
  const phase: ExtensionPhase =
    rawPhase !== 'install' && !detectedDwellOver
      ? 'install'
      : returning
      ? 'link'
      : linkHold !== 'released' && (rawPhase === 'pin' || rawPhase === 'signal')
      ? 'link'
      : rawPhase

  const wireState: HandshakeWireState =
    phase !== 'link'
      ? phase === 'install'
        ? 'idle'
        : 'linked'
      : linked && linkHold !== 'volley'
      ? 'linked'
      : linkFailed
      ? 'failed'
      : linkUnverified
      ? 'unverified'
      : 'linking'

  // Detection flips the INSTALL pill to its check; hold that frame for a
  // beat before the swap. The ref mirrors the state for the hold effect
  // below, which runs in this same commit and would otherwise read the
  // stale `true` from before detection and start the volley clock 700ms
  // before the wire is on screen.
  const dwellOverRef = useRef(!detected)
  useEffect(() => {
    if (!detected) {
      dwellOverRef.current = true
      setDetectedDwellOver(true)
      return
    }
    dwellOverRef.current = false
    setDetectedDwellOver(false)
    const id = window.setTimeout(() => {
      dwellOverRef.current = true
      setDetectedDwellOver(true)
    }, DETECTED_DWELL_MS)
    return () => window.clearTimeout(id)
  }, [detected])

  // The LINK hold. Once the dwell lifts, a mount that ever needed to link
  // shows the volley from that moment for at least MIN_LINKING_MS,
  // however fast registration was underneath, then the solid wire for
  // LINKED_DWELL_MS — a raw advance to PIN or SIGNAL waits both out. A
  // mount that was linked from its first handshake never saw LINK and
  // has nothing to protect; reduced motion holds nothing either. Falling
  // back to INSTALL (identity lost) resets.
  useEffect(() => {
    if (rawPhase === 'install') {
      sawLinkRef.current = false
      linkingSinceRef.current = null
      setLinkHold('released')
      return
    }
    if (rawPhase === 'link') sawLinkRef.current = true
    if (!detectedDwellOver || !dwellOverRef.current) return
    if (!sawLinkRef.current) {
      setLinkHold('released')
      return
    }
    if (linkingSinceRef.current === null) linkingSinceRef.current = Date.now()
    if (rawPhase === 'link') {
      setLinkHold('volley')
      return
    }
    const reduced = welcomeMotionReduced()
    const volleyEndsAt = linkingSinceRef.current + (reduced ? 0 : MIN_LINKING_MS)
    const releaseAt = volleyEndsAt + (reduced ? 0 : LINKED_DWELL_MS)
    const now = Date.now()
    if (now >= releaseAt) {
      setLinkHold('released')
      return
    }
    const timers: number[] = []
    if (now < volleyEndsAt) {
      setLinkHold('volley')
      timers.push(window.setTimeout(() => setLinkHold('linked'), volleyEndsAt - now))
    } else {
      setLinkHold('linked')
    }
    timers.push(window.setTimeout(() => setLinkHold('released'), releaseAt - now))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [rawPhase, detectedDwellOver])

  // Forward a previously linked user after a beat on LINKED — only once
  // the dwell and the volley (if there was one) have finished, so the
  // confirmation is seen whole.
  useEffect(() => {
    if (!returning || !detectedDwellOver || linkHold !== 'released' || !canEnter) {
      return
    }
    const id = window.setTimeout(onDone, LINKED_PAUSE_MS)
    return () => window.clearTimeout(id)
  }, [returning, detectedDwellOver, linkHold, canEnter, onDone])

  // Always-on: remember when the tab last went hidden. Kept separate from
  // the arming logic below so the timestamp is there even when the store
  // click and the tab switch land in the same frame.
  useEffect(() => {
    const track = () => {
      if (document.visibilityState === 'hidden') hiddenAtRef.current = Date.now()
    }
    document.addEventListener('visibilitychange', track)
    return () => document.removeEventListener('visibilitychange', track)
  }, [])

  // RECONNECTING for a beat, then the page persists and reloads. The
  // timer ref is the double-fire guard: visibilitychange and focus both
  // land on a tab switch, and the manual Reconnect link shares this path.
  const beginReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) return
    setReconnecting(true)
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      onReconnect()
    }, RECONNECT_BEAT_MS)
  }, [onReconnect])

  useEffect(
    () => () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
      }
    },
    []
  )

  // Detection landing during the beat makes the reload pointless: the
  // hook's own wake attempt may well answer first once the extension
  // injects into open tabs. Stand down.
  useEffect(() => {
    if (!detected || reconnectTimerRef.current === null) return
    window.clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
    setReconnecting(false)
  }, [detected])

  // Auto-reconnect, armed only after a store visit, only while nothing is
  // detected, and only once (autoReconnects === 0) so a broken install
  // can't spin the tab. Fires on the first return that was long enough
  // to have been an install.
  useEffect(() => {
    if (
      !capableBrowser ||
      detected ||
      progress.storeOpenedAt === null ||
      progress.autoReconnects !== 0 ||
      devPhaseOverride !== null
    ) {
      return
    }
    const back = () => {
      if (document.visibilityState === 'hidden') return
      const hiddenAt = hiddenAtRef.current
      if (hiddenAt === null || Date.now() - hiddenAt < AUTO_RECONNECT_AWAY_MS) {
        return
      }
      // One return, one decision — focus firing after visibilitychange
      // must not evaluate the same absence twice.
      hiddenAtRef.current = null
      beginReconnect()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [
    capableBrowser,
    detected,
    progress.storeOpenedAt,
    progress.autoReconnects,
    devPhaseOverride,
    beginReconnect
  ])

  // LINK: register this device the moment the handshake says it isn't
  // bound to this account. Depends on the uuid and the linked bit, not
  // the identity object, so a refresh that answers "not yet" doesn't
  // re-run this underneath the recheck loop.
  const deviceUuid = identity?.deviceUuid ?? null
  useEffect(() => {
    if (devPhaseOverride !== null) return
    if (!detected || deviceUuid === null || userId === null) return
    if (linked || linkFailed) return
    if (registeredUuidsRef.current.has(deviceUuid)) return
    registeredUuidsRef.current.add(deviceUuid)
    void (async () => {
      // A rejected fetch (offline) fails the same way a non-2xx does.
      const result = await registerDeviceWithBackend(userId, deviceUuid).catch(
        () => null
      )
      if (!result?.ok) {
        registeredUuidsRef.current.delete(deviceUuid)
        if (!unmountedRef.current) setLinkFailed(true)
        return
      }
      // Hand the token over even after an unmount — the extension needs
      // it whether or not this stage is still watching.
      notifyDeviceRegistered({
        deviceUuid,
        userId,
        ...(result.syncToken ? { syncToken: result.syncToken } : {})
      })
      for (let i = 0; i < LINK_RECHECKS; i++) {
        if (unmountedRef.current) return
        const next = await refresh()
        if (isLinked(next, userId)) return
        await new Promise((resolve) => window.setTimeout(resolve, LINK_RECHECK_MS))
      }
      // The server has the device but the extension never confirmed.
      // Surface it; a retry re-posts, which is exactly right if the
      // extension lost the token on its side. A push that landed the
      // link between the last recheck and here wins.
      if (unmountedRef.current || isLinked(identityRef.current, userId)) return
      registeredUuidsRef.current.delete(deviceUuid)
      setLinkFailed(true)
    })()
  }, [
    devPhaseOverride,
    detected,
    deviceUuid,
    userId,
    linked,
    linkFailed,
    linkAttempt,
    refresh
  ])

  const retryLink = useCallback(() => {
    setLinkFailed(false)
    setLinkAttempt((n) => n + 1)
  }, [])

  // Pushes from the extension. A REGISTRATION_CHANGED (relayed as
  // CRIBBLE_EXTENSION_DETECTED) that says linked while our view says
  // otherwise triggers one handshake so the truth lands without waiting
  // on a poll; a CRIBBLE_POINTS_EARNED is the first signal. Our own RPC
  // replies pass through here too — the identityRef check keeps that to
  // at most one redundant handshake.
  useEffect(() => {
    if (!detected || userId === null) return
    return subscribeExtensionMessages((msg) => {
      if (msg.type === 'CRIBBLE_EXTENSION_DETECTED') {
        const saysLinked =
          msg.isRegistered === true &&
          msg.hasSyncToken === true &&
          msg.userId === userId
        if (saysLinked && !isLinked(identityRef.current, userId)) void refresh()
        return
      }
      if (msg.type === 'CRIBBLE_POINTS_EARNED') {
        const points =
          typeof msg.points === 'number' && Number.isFinite(msg.points) && msg.points > 0
            ? Math.round(msg.points)
            : null
        const domain =
          typeof msg.domain === 'string' && msg.domain.length > 0 && msg.domain !== 'unknown'
            ? msg.domain
            : null
        if (points === null || domain === null) return
        setSignal((current) => current ?? { kind: 'points', points, domain })
      }
    })
  }, [detected, userId, refresh])

  // While listening, coming back to this tab asks the extension for its
  // queue: a push can miss (this tab asleep), a queued event can't.
  useEffect(() => {
    if (phase !== 'signal' || signal !== null || devPhaseOverride !== null) return
    const wake = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_GAP_MS) return
      lastFocusRefreshRef.current = now
      void refresh()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [phase, signal, devPhaseOverride, refresh])

  useEffect(() => {
    if (phase !== 'signal' || signal !== null) return
    const queued = identity?.queueSize ?? 0
    if (queued > 0) setSignal({ kind: 'queued', count: queued })
  }, [phase, signal, identity])

  /* ---------------- motion ---------------- */

  // Phase-card swap: the leaving body drops out fast, then the swap
  // commits and the entering body rises in below. Both legs ease out —
  // an exit that eases in spends its slow start on the moment the user
  // is watching. shownPhase trails phase by exactly one leave.
  const [shownPhase, setShownPhase] = useState<ExtensionPhase>(phase)
  useGSAP(
    () => {
      if (shownPhase === phase) return
      const leaving = rootRef.current?.querySelector<HTMLElement>(
        `[data-phase-body="${shownPhase}"]`
      )
      if (!leaving || welcomeMotionReduced()) {
        setShownPhase(phase)
        return
      }
      gsap.to(leaving, {
        autoAlpha: 0,
        y: -6,
        duration: 0.18,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => setShownPhase(phase)
      })
    },
    { scope: rootRef, dependencies: [phase, shownPhase], revertOnUpdate: true }
  )

  useGSAP(
    () => {
      // First mount is the page's stage entrance; only later swaps enter
      // here. Comparing against the last value (not a mounted flag) keeps
      // StrictMode's remount from doubling it.
      if (lastShownRef.current === null) {
        lastShownRef.current = shownPhase
        return
      }
      if (lastShownRef.current === shownPhase) return
      lastShownRef.current = shownPhase
      const reduced = welcomeMotionReduced()
      rootRef.current
        ?.querySelector(`[data-phase="${shownPhase}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
      if (reduced) return
      gsap.fromTo(
        `[data-phase-body="${shownPhase}"]`,
        { autoAlpha: 0, y: 6 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.26,
          ease: CRIBBLE_EASE,
          clearProps: 'transform,opacity,visibility'
        }
      )
    },
    { scope: rootRef, dependencies: [shownPhase] }
  )

  // Rail: the current phase's segment and everything before it fill;
  // FIRST SIGNAL only completes once a signal lands. During the reconnect
  // beat the LINK segment reaches ahead (filled + breathing) to say where
  // this is going. Reduced motion snaps.
  const signalDone = signal !== null
  const filledCount = PHASE_INDEX[phase] + 1
  const breathing = reconnecting
    ? PHASE_INDEX.link
    : phase === 'signal' && signalDone
    ? -1
    : PHASE_INDEX[phase]
  useGSAP(
    () => {
      const fills = gsap.utils.toArray<HTMLElement>('.ext-rail-fill', rootRef.current)
      fills.forEach((fill, i) => {
        const on = i < filledCount || (reconnecting && i === PHASE_INDEX.link)
        if (welcomeMotionReduced()) {
          gsap.set(fill, { scaleX: on ? 1 : 0 })
          return
        }
        gsap.to(fill, {
          scaleX: on ? 1 : 0,
          duration: 0.7,
          ease: CRIBBLE_EASE,
          overwrite: 'auto'
        })
      })
    },
    { scope: rootRef, dependencies: [filledCount, reconnecting] }
  )

  // Points count-up on the first signal: a proxy tween writes the digits,
  // then lands on exactly what React rendered.
  useGSAP(
    () => {
      if (signal?.kind !== 'points') return
      const el = pointsRef.current
      if (!el) return
      const final = `+${signal.points}`
      if (welcomeMotionReduced()) {
        el.textContent = final
        return
      }
      const counter = { n: 0 }
      gsap.to(counter, {
        n: signal.points,
        duration: COUNT_UP_S,
        ease: CRIBBLE_EASE,
        snap: { n: 1 },
        onUpdate: () => {
          el.textContent = `+${Math.round(counter.n)}`
        },
        onComplete: () => {
          el.textContent = final
        }
      })
    },
    { scope: rootRef, dependencies: [signal] }
  )

  /* ---------------- handlers ---------------- */

  const openStore = useCallback(() => {
    onProgress({ storeOpenedAt: Date.now() })
  }, [onProgress])

  const acknowledgePin = useCallback(() => {
    onProgress({ pinAcknowledged: true })
  }, [onProgress])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/welcome`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [])

  /* ---------------- render ---------------- */

  const ctaLabel = finalStep ? 'Enter dashboard' : 'Continue'

  // A detected extension on a "non-capable" browser (sideloaded, or a
  // listing that went live after this build) still gets the sequence.
  const showSequence = capableBrowser || detected

  if (!showSequence) {
    return (
      <StageShell
        step={step}
        stage="extension"
        title="Install cribble-engine."
        subtitle="Cribble cannot count browser time until this is on. It measures which tools you open and for how long. Not what you type."
      >
        {/* Same scope root as the sequence: the useGSAP hooks above still
            run here (as no-ops) and a null scope makes gsap warn. */}
        <div ref={rootRef}>
          <div className="card-enter glass-lite mt-9 rounded-2xl p-6">
            <div className="flex items-center gap-2.5">
              <span className="text-zinc-400">
                <IconPuzzle size={17} />
              </span>
              <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
                DESKTOP ONLY
              </span>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-zinc-200">
              Nothing counts until the extension runs on desktop{' '}
              {installableBrowserNames()}.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Copy this link and open it there. Your answers are saved; the
              extension takes a minute to set up.
            </p>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="press-scale mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              <IconCopy size={11} />
              {copied ? 'COPIED' : 'COPY LINK'}
            </button>
          </div>

          <StageActions>
            <PrimaryButton onClick={onDone} disabled={!canEnter}>
              {finalStep ? 'Enter dashboard anyway' : 'Continue anyway'}
            </PrimaryButton>
          </StageActions>
        </div>
      </StageShell>
    )
  }

  // INSTALL's status ladder. After a self-triggered reload the first
  // handshake is still settling, so RECONNECTING carries across it.
  const installStatus: { text: string; tone: StatusTone; live: StatusLive } =
    detected
      ? { text: 'EXTENSION DETECTED', tone: 'accent', live: 'check' }
      : reconnecting || (!checked && progress.autoReconnects > 0)
      ? { text: 'RECONNECTING', tone: 'lit', live: 'pulse' }
      : { text: 'WAITING FOR INSTALL…', tone: 'muted', live: 'pulse' }
  const showFallback =
    !detected && !reconnecting && checked && progress.autoReconnects >= 1

  const installDone = phase !== 'install'
  const linkDone = PHASE_INDEX[phase] > PHASE_INDEX.link || wireState === 'linked'
  const pinDone = phase === 'signal'
  const surfaces = signalSurfaces(topTools)

  return (
    <StageShell
      step={step}
      stage="extension"
      title="Install cribble-engine."
      subtitle="Cribble cannot count browser time until this is on and linked to your account. It measures which tools you open and for how long. Not what you type."
    >
      <div ref={rootRef}>
        {/* Phase rail */}
        <div className="card-enter glass-lite mt-9 rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span className="text-accent">
              <IconPuzzle size={17} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              CRIBBLE ENGINE · SETUP SEQUENCE
            </span>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-1.5">
            {PHASES.map((p, i) => {
              const idx = PHASE_INDEX[phase]
              const tone =
                i < idx || (i === idx && phase === 'signal' && signalDone)
                  ? 'text-accent'
                  : i === idx
                  ? 'text-zinc-200'
                  : 'text-zinc-600'
              return (
                <div key={p.id}>
                  <div
                    className={`font-mono text-[8px] leading-tight tracking-[0.2em] transition-colors duration-300 sm:text-[9px] sm:tracking-[0.25em] ${tone}`}
                  >
                    {p.label}
                  </div>
                  <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className={`ext-rail-fill rail-fill h-full origin-left scale-x-0 rounded-full ${
                        breathing === i ? 'rail-breathe' : ''
                      }`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          {onDevPhaseOverride && (
            <DevPhaseRow value={devPhaseOverride} onChange={onDevPhaseOverride} />
          )}
        </div>

        <div className="mt-3 space-y-3">
          <PhaseCard
            id="install"
            index="01"
            label="INSTALL"
            title="Add it from the store"
            done={installDone}
            active={phase === 'install'}
            status={
              installDone ? <StatusWord tone="accent">EXTENSION DETECTED</StatusWord> : undefined
            }
          >
            {shownPhase === 'install' && (
              <div data-phase-body="install">
                <div
                  className={`grid grid-cols-1 gap-3 ${
                    EXTENSION_STORES.length > 1 ? 'md:grid-cols-2' : ''
                  }`}
                >
                  {EXTENSION_STORES.map((store) => (
                    <StoreCard
                      key={store.family}
                      store={store}
                      sublabel={storeSublabel(store, forkName)}
                      highlighted={store.family === browserFamily}
                      onOpen={openStore}
                    />
                  ))}
                </div>
                <div className="mt-4">
                  <StatusPill
                    text={installStatus.text}
                    tone={installStatus.tone}
                    live={installStatus.live}
                  />
                  {showFallback && (
                    <div className="note-enter mt-2.5 pl-8">
                      <p className="text-xs leading-relaxed text-zinc-400">
                        Installed it and nothing happened?{' '}
                        <button
                          type="button"
                          onClick={beginReconnect}
                          className="text-zinc-200 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-50 hover:decoration-zinc-400"
                        >
                          Reconnect
                        </button>
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                        Accept the permissions dialog in the store, then come
                        back to this tab.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </PhaseCard>

          <PhaseCard
            id="link"
            index="02"
            label="LINK"
            title="Bind it to your account"
            done={linkDone}
            active={phase === 'link'}
            status={
              phase !== 'link' && linkDone ? (
                <StatusWord tone="accent">LINKED</StatusWord>
              ) : undefined
            }
          >
            {shownPhase === 'link' && (
              <div data-phase-body="link">
                {/* Pulled out of the body indent to the card's full width:
                    the SYN·ACK log line truncates below ~300px. */}
                <div className="-ml-8 w-[calc(100%+2rem)]">
                  <HandshakeWire state={wireState} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-600">
                  {wireState === 'linked'
                    ? 'This device is bound to your account. It syncs on its own every 30 seconds.'
                    : wireState === 'failed'
                    ? 'The server did not confirm this device. Retry sends the request again; nothing else changes.'
                    : wireState === 'unverified'
                    ? 'Your account details did not load, so the link cannot be confirmed here. The dashboard binds this device the moment you arrive.'
                    : 'Binding this device to your account. Nothing to click.'}
                </p>
                {/* The wire's log already reads LINK FAILED; the pill is
                    only the action. */}
                {wireState === 'failed' && (
                  <button
                    type="button"
                    onClick={retryLink}
                    className="press-scale mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                  >
                    RETRY
                  </button>
                )}
              </div>
            )}
          </PhaseCard>

          <PhaseCard
            id="pin"
            index="03"
            label="PIN"
            title="Keep the mark in reach"
            done={pinDone}
            active={phase === 'pin'}
            status={pinDone ? <StatusWord tone="accent">PINNED</StatusWord> : undefined}
          >
            {shownPhase === 'pin' && (
              <div data-phase-body="pin">
                <div className="grid items-center gap-5 md:grid-cols-[300px_1fr]">
                  <ToolbarLesson playing={phase === 'pin'} />
                  <ol className="space-y-2.5 font-mono text-[11px] leading-snug tracking-[0.06em] text-zinc-300">
                    <PinStep n="01">Click the puzzle piece</PinStep>
                    <PinStep n="02">Pin Cribble</PinStep>
                    <PinStep n="03">Click the mark any time for your live score</PinStep>
                  </ol>
                </div>
                <MarkDoneButton onClick={acknowledgePin}>PINNED IT</MarkDoneButton>
              </div>
            )}
          </PhaseCard>

          <PhaseCard
            id="signal"
            index="04"
            label="FIRST SIGNAL"
            title="Take it for a spin"
            done={signalDone}
            active={phase === 'signal'}
          >
            {shownPhase === 'signal' && (
              <div data-phase-body="signal">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {surfaces.map((surface) => (
                    <a
                      key={surface.id}
                      href={surface.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press-scale group flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 transition-colors duration-300 hover:border-zinc-600"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-400 transition-colors duration-300 group-hover:text-zinc-100">
                        <surface.icon size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-zinc-100">
                          {surface.label}
                        </span>
                        <span className="block truncate font-mono text-[9px] tracking-[0.15em] text-zinc-600">
                          {surface.host}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
                <div className="mt-4">
                  {signal === null ? (
                    <StatusPill text="LISTENING…" tone="muted" live="pulse" />
                  ) : (
                    <div className="flex items-center gap-3">
                      <CheckLight />
                      <span className="font-mono text-[10px] tracking-[0.3em] text-accent">
                        FIRST SIGNAL
                        {signal.kind === 'points' ? (
                          <>
                            <span className="text-zinc-600"> · </span>
                            <span ref={pointsRef} className="tabular-nums">
                              +{signal.points}
                            </span>
                            <span className="text-zinc-600"> · </span>
                            <span className="normal-case tracking-[0.15em] text-zinc-300">
                              {signal.domain}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-zinc-600"> · </span>
                            <span className="tabular-nums">{signal.count}</span>
                            <span className="text-zinc-400"> QUEUED</span>
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                  Counts browser tabs only. Cursor, Claude Code and Codex are
                  counted by the CLI.
                </p>
              </div>
            )}
          </PhaseCard>
        </div>

        <StageActions>
          <PrimaryButton onClick={onDone} disabled={!canEnter} emphasized={canEnter}>
            {ctaLabel}
          </PrimaryButton>
        </StageActions>
      </div>
    </StageShell>
  )
}

/* ============================================================
   Pieces
   ============================================================ */

/** Store link card — a plain external link, never a radio: installing is
 *  proven by the detection handshake, not by clicking. The click is
 *  remembered only to arm the auto-reconnect. The highlight marks the
 *  card matching the running browser. */
function StoreCard({
  store,
  sublabel,
  highlighted,
  onOpen
}: {
  store: ExtensionStore
  sublabel: string
  highlighted: boolean
  onOpen: () => void
}) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className={`press-scale relative block rounded-xl border bg-zinc-950/70 p-4 transition-[border-color,background-color,box-shadow,color] duration-300 ${
        highlighted
          ? 'phos-selected border-accent/25'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      {highlighted && (
        <span className="absolute right-3 top-3 rounded-full border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[9px] tracking-[0.25em] text-accent">
          THIS BROWSER
        </span>
      )}
      <div className="flex items-center gap-4">
        <CardIcon icon={store.icon} selected={highlighted} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            {store.cta}
            <IconArrowRight size={13} className="text-zinc-500" />
          </div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{sublabel}</div>
        </div>
      </div>
    </a>
  )
}

function PinStep({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="shrink-0 tracking-[0.25em] text-accent">{n}</span>
      <span>{children}</span>
    </li>
  )
}

/** The CRT status light: dark chip, hairline ring, glowing check. */
function CheckLight() {
  return (
    <span className="check-pop phos-check inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-zinc-950 text-accent">
      <IconCheck size={11} />
    </span>
  )
}

type StatusTone = 'muted' | 'lit' | 'accent'
type StatusLive = 'pulse' | 'check'

const STATUS_TONE: Record<StatusTone, string> = {
  muted: 'text-zinc-500',
  lit: 'text-zinc-200',
  accent: 'text-accent'
}

/** A phase card's header status word. */
function StatusWord({
  tone,
  children
}: {
  tone: StatusTone
  children: React.ReactNode
}) {
  return (
    <span className={`font-mono text-[9px] tracking-[0.25em] ${STATUS_TONE[tone]}`}>
      {children}
    </span>
  )
}

/** Indicator + mono status word, the ladder's rung inside an active card.
 *  Text changes are typed in (anime.js), never faded. */
function StatusPill({
  text,
  tone,
  live
}: {
  text: string
  tone: StatusTone
  live: StatusLive
}) {
  return (
    <div className="flex items-center gap-3">
      {live === 'check' ? (
        <CheckLight />
      ) : (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600" />
        </span>
      )}
      <TypedStatus text={text} className={STATUS_TONE[tone]} />
    </div>
  )
}

/** Mono status text with a typewriter on every change after the first —
 *  the first is the page's stage entrance. A stable live region carries
 *  the words to screen readers; the typed copy is texture. */
function TypedStatus({ text, className }: { text: string; className: string }) {
  const initialRef = useRef(text)
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
      {/* Keyed on the text so anime always gets a fresh element and never
          reconciles a node the splitter has replaced. */}
      <TypedLine key={text} text={text} typed={text !== initialRef.current} className={className} />
    </>
  )
}

function TypedLine({
  text,
  typed,
  className
}: {
  text: string
  typed: boolean
  className: string
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !typed || welcomeMotionReduced()) return
    const split = splitText(el, { chars: true, words: true, lines: false })
    const chars = split.chars as HTMLElement[]
    if (chars.length === 0) {
      split.revert()
      return
    }
    // Hide before anime's first tick, or the line flashes whole for a
    // frame. The per-glyph step shrinks for long lines so every status
    // lands inside the same budget.
    for (const char of chars) char.style.opacity = '0'
    const per = Math.max(4, Math.min(12, Math.floor(TYPE_BUDGET_MS / chars.length)))
    const anim = animate(chars, {
      opacity: [0, 1],
      duration: per,
      delay: stagger(per),
      ease: steps(1)
    })
    return () => {
      anim.revert()
      split.revert()
    }
  }, [typed])
  return (
    <samp
      ref={ref}
      aria-hidden
      className={`font-mono text-[10px] tracking-[0.3em] ${className}`}
    >
      {text}
    </samp>
  )
}

/** ?dev=1 only: force a phase to eyeball each card without an extension. */
function DevPhaseRow({
  value,
  onChange
}: {
  value: ExtensionPhase | null
  onChange: (phase: ExtensionPhase | null) => void
}) {
  const options: { id: ExtensionPhase | null; label: string }[] = [
    { id: null, label: 'AUTO' },
    ...PHASES.map((p) => ({ id: p.id, label: p.label }))
  ]
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-zinc-800 pt-3 font-mono">
      <span className="px-1 text-[9px] tracking-[0.3em] text-zinc-600">DEV PHASE</span>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded px-2 py-1 text-[9px] tracking-[0.2em] transition-colors ${
            value === option.id ? 'bg-accent/10 text-accent' : 'text-zinc-500 hover:text-zinc-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
