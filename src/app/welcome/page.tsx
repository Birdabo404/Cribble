'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ROLE_ICONS } from '@/components/roleIcons'
import type { CountMode } from '@/lib/countMode'
import { parseCountMode } from '@/lib/countMode'
import { ROLE_OPTIONS } from '@/lib/roles'
import {
  EXTENSION_INSTALL_URL,
  FIREFOX_EXTENSION_INSTALL_URL,
  currentExtensionBrowserFamily,
  evaluateExtensionGate,
  installableBrowserNames,
  isExtensionCapableBrowser,
  isExtensionInstallEnabled,
  type ExtensionBrowserFamily
} from '@/lib/extensionInstall'
import { TEAM_TERMS, type BillingTerm } from '@/lib/planTerms'
import { useExtensionDetection } from '@/hooks/useExtensionDetection'
import { AgentLinkStage } from '@/components/welcome/AgentLinkStage'
import { CountStage } from '@/components/welcome/CountStage'
import {
  CardIcon,
  ChoiceCard,
  GhostButton,
  PrimaryButton,
  StageActions,
  StageShell,
  type IconComponent,
  type Stage
} from '@/components/welcome/shared'
import {
  CRIBBLE_EASE,
  welcomeMotionReduced
} from '@/components/welcome/welcomeMotion'
import {
  EMPTY_AGENT_PROGRESS,
  clearWelcomeProgress,
  isProgressFresh,
  loadWelcomeProgress,
  saveWelcomeProgress,
  type AgentProgressSnapshot,
  type WelcomeProgress
} from '@/components/welcome/welcomeProgress'
import {
  BrandBolt,
  BrandChrome,
  BrandClaude,
  BrandCopilot,
  BrandCursor,
  BrandDeepSeek,
  BrandFirefox,
  BrandGemini,
  BrandGrok,
  BrandLovable,
  BrandMidjourney,
  BrandOpenAI,
  BrandPerplexity,
  BrandReplit,
  BrandV0,
  BrandWindsurf,
  IconActivity,
  IconArrowRight,
  IconAsterisk,
  IconBookOpen,
  IconCheck,
  IconGrid,
  IconMicroscope,
  IconOrbit,
  IconShieldCheck,
  IconSolo,
  IconSparkles,
  IconTeam,
  IconWrench,
  IconX,
  IconZap
} from '@/components/welcome/icons'

// The store URLs are build-time env constants, so the browser lane's step
// list can be fixed once at module level: no listing in any store → no
// extension step, and that lane behaves exactly as it did before the step
// existed.
const EXTENSION_STEP_ENABLED = isExtensionInstallEnabled()

// ?next= comes from the ExtensionGate bounce and restores where the user
// was headed once the gate passes. Only same-origin paths may ride it:
// reject anything that doesn't start with a single "/" so it can never
// become an open redirect.
function sanitizeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

// The questionnaire shared by every solo lane; what follows tools is a
// function of the chosen count mode.
const QUESTION_STEPS: Stage[] = [
  'mode',
  'count',
  'privacy',
  'role',
  'goal',
  'tools'
]

// The solo path branches after the questionnaire: browser accounts get the
// extension wall (when a store listing is live), token accounts get the
// agent-link stage, and 'both' runs the wall first and the agent second —
// the wall is mandatory, the agent stage has its own escape. Null (nothing
// picked yet) walks the pre-redesign browser lane.
function soloSteps(countMode: CountMode | null): Stage[] {
  const mode = countMode ?? 'browser'
  switch (mode) {
    case 'browser':
      return EXTENSION_STEP_ENABLED
        ? [...QUESTION_STEPS, 'extension']
        : [...QUESTION_STEPS]
    case 'tokens':
      return [...QUESTION_STEPS, 'agent']
    case 'both':
      return EXTENSION_STEP_ENABLED
        ? [...QUESTION_STEPS, 'extension', 'agent']
        : [...QUESTION_STEPS, 'agent']
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

const TEAM_STEPS: Stage[] = ['mode', 'team']

// Every stage the dev jumper can reach — deliberately the full union, not
// the active path, so all four onboarding lanes can be walked without
// re-answering the questionnaire each time.
const DEV_STAGES: Stage[] = [
  'intro',
  'mode',
  'team',
  'count',
  'privacy',
  'role',
  'goal',
  'tools',
  ...(EXTENSION_STEP_ENABLED ? (['extension'] as Stage[]) : []),
  'agent'
]

/** Gold is the team plan's hue everywhere (console, /teams, badges) —
 *  used sparingly here as an accent inside the wizard's own language. */
const GOLD = 'var(--lb-gold)'

type ExtensionStore = {
  family: ExtensionBrowserFamily
  storeName: string
  cta: string
  icon: IconComponent
  url: string
}

// One card per live store listing — no empty slot for a store that isn't
// live. Today that's Chrome alone; the Firefox card appears the moment
// NEXT_PUBLIC_FIREFOX_EXTENSION_STORE_URL ships, the same switch that
// turns on the Firefox gate and nudge.
const EXTENSION_STORES: ExtensionStore[] = [
  ...(EXTENSION_INSTALL_URL !== null
    ? [
        {
          family: 'chrome' as const,
          storeName: 'Chrome Web Store',
          cta: 'Add to Chrome',
          icon: BrandChrome,
          url: EXTENSION_INSTALL_URL
        }
      ]
    : []),
  ...(FIREFOX_EXTENSION_INSTALL_URL !== null
    ? [
        {
          family: 'firefox' as const,
          storeName: 'Firefox Add-ons',
          cta: 'Add to Firefox',
          icon: BrandFirefox,
          url: FIREFOX_EXTENSION_INSTALL_URL
        }
      ]
    : [])
]

// Shared vocabulary (src/lib/roles.ts) + glyphs — the same list the
// profile editor offers, so a role picked here can always be changed later.
const ROLES: { id: string; label: string; hint: string; icon: IconComponent }[] =
  ROLE_OPTIONS.map((r) => ({
    id: r.id,
    label: r.label,
    hint: r.hint,
    icon: ROLE_ICONS[r.id] ?? IconSparkles
  }))

const GOALS: { id: string; label: string; hint: string; icon: IconComponent }[] = [
  { id: 'learn', label: 'Learn a skill', hint: 'study, practice, level up', icon: IconBookOpen },
  { id: 'build', label: 'Build a product', hint: 'ship something real', icon: IconWrench },
  { id: 'research', label: 'Do research', hint: 'academic or industry', icon: IconMicroscope },
  { id: 'work', label: 'Work faster', hint: 'more done per day', icon: IconZap },
  { id: 'hobby', label: 'Stay curious', hint: 'No brief. Just looking around.', icon: IconOrbit },
  { id: 'other', label: 'Something else', hint: 'tell us later', icon: IconAsterisk }
]

type ToolOption = { id: string; label: string; icon: IconComponent }

// The loadout, grouped the way people actually think about these tools.
// The ids mirror the onboarding API's TOOLS validation list exactly.
// Claude Code and Codex ride their parent company marks.
const TOOL_GROUPS: { label: string | null; tools: ToolOption[] }[] = [
  {
    label: 'CHAT',
    tools: [
      { id: 'chatgpt', label: 'ChatGPT', icon: BrandOpenAI },
      { id: 'claude', label: 'Claude', icon: BrandClaude },
      { id: 'gemini', label: 'Gemini', icon: BrandGemini },
      { id: 'grok', label: 'Grok', icon: BrandGrok },
      { id: 'perplexity', label: 'Perplexity', icon: BrandPerplexity },
      { id: 'deepseek', label: 'DeepSeek', icon: BrandDeepSeek }
    ]
  },
  {
    label: 'CODING AGENTS',
    tools: [
      { id: 'cursor', label: 'Cursor', icon: BrandCursor },
      { id: 'claude-code', label: 'Claude Code', icon: BrandClaude },
      { id: 'codex', label: 'Codex', icon: BrandOpenAI },
      { id: 'copilot', label: 'Copilot', icon: BrandCopilot },
      { id: 'windsurf', label: 'Windsurf', icon: BrandWindsurf }
    ]
  },
  {
    label: 'BUILDERS',
    tools: [
      { id: 'v0', label: 'v0', icon: BrandV0 },
      { id: 'lovable', label: 'Lovable', icon: BrandLovable },
      { id: 'bolt', label: 'Bolt', icon: BrandBolt },
      { id: 'replit', label: 'Replit', icon: BrandReplit }
    ]
  },
  {
    // The stragglers row carries no label on purpose: three named groups
    // is the ceiling before the labels stop meaning anything.
    label: null,
    tools: [
      { id: 'midjourney', label: 'Midjourney', icon: BrandMidjourney },
      { id: 'other', label: 'Other', icon: IconGrid }
    ]
  }
]

const AMBIENCE_AUDIO_PATH = '/audio/deeper-into-it.mp3'

// The intro stage can't advance until the onboarding status fetch
// settles; if it hangs (stalled proxy, dead connection), abort here so
// the catch marks the status known and the page fails open into the
// wizard — same fallback as a fetch error.
const ONBOARDING_STATUS_TIMEOUT_MS = 10_000

// The brand moment's floor. Both intro timers respect it: the main timer
// fires at exactly this point, and the safety re-check (signals settling
// late) waits out whatever remains of it before advancing.
const MIN_INTRO_MS = 1800
const INTRO_RECHECK_MS = 200

// Dwell on the "EXTENSION DETECTED" confirmation before auto-forwarding,
// long enough to read as a state change instead of a flicker.
const EXTENSION_DETECTED_PAUSE_MS = 900

export default function WelcomePage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('intro')
  // The GSAP stage swap: goTo() parks the target here, a leave tween runs
  // on the current stage, and its onComplete commits the swap. Reduced
  // motion (and the intro, which has no keyed wrapper) commits instantly.
  const [pendingStage, setPendingStage] = useState<Stage | null>(null)
  const [mode, setMode] = useState<string | null>(null)
  const [countMode, setCountMode] = useState<CountMode | null>(null)
  // count_mode from saved onboarding metadata — lets a returning user's
  // gate verdict (and step list) branch without re-walking the count stage.
  const [savedCountMode, setSavedCountMode] = useState<CountMode | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [goal, setGoal] = useState<string | null>(null)
  const [topTools, setTopTools] = useState<string[]>([])
  // Yearly leads, same as every other team surface: the honest default is
  // the best deal.
  const [teamTerm, setTeamTerm] = useState<BillingTerm>('yearly')
  const [saving, setSaving] = useState(false)
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false)
  const [statusKnown, setStatusKnown] = useState(false)
  const [extensionLinked, setExtensionLinked] = useState(false)
  // From saved onboarding metadata; team buyers pass the extension gate.
  // Anything that is not strictly 'team' counts as solo.
  const [accountType, setAccountType] = useState<'solo' | 'team'>('solo')
  // UA sniffing must wait for the client — SSR only ever renders the
  // intro, which doesn't read this.
  const [capableBrowser, setCapableBrowser] = useState(false)
  // Which store card the extension stage highlights; null highlights none.
  const [browserFamily, setBrowserFamily] =
    useState<ExtensionBrowserFamily | null>(null)
  const [devMode, setDevMode] = useState(false)
  // The agent stage's phase booleans, lifted here so session resume can
  // persist and restore them across a reload.
  const [agentProgress, setAgentProgress] =
    useState<AgentProgressSnapshot>(EMPTY_AGENT_PROGRESS)
  const devRequestedRef = useRef(false)
  const nextPathRef = useRef<string | null>(null)
  // When the intro was first painted — the safety timer below measures its
  // remaining minimum against this.
  const introStartedAtRef = useRef(Date.now())
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const swapRef = useRef<HTMLDivElement>(null)
  // One detection loop for the whole page: the intro verdict and the
  // extension stage both read it, and it keeps polling until detected —
  // which is what lets a mid-stage install unlock the CTA by itself.
  const { detected, checked } = useExtensionDetection(EXTENSION_STEP_ENABLED)

  const goTo = useCallback((next: Stage) => setPendingStage(next), [])

  // Stage leave: fast and downward-out, then commit the swap. The tween is
  // created inside useGSAP so it lives in the component's context (killed
  // on unmount); revertOnUpdate discards a stale leave if the target
  // changes mid-flight.
  useGSAP(
    () => {
      if (!pendingStage) return
      const commit = () => {
        setStage(pendingStage)
        setPendingStage(null)
        // The next stage always starts from the top; smooth unless motion
        // is reduced, in which case it snaps.
        window.scrollTo({
          top: 0,
          behavior: welcomeMotionReduced() ? 'auto' : 'smooth'
        })
      }
      const el = swapRef.current
      if (!el || welcomeMotionReduced()) {
        commit()
        return
      }
      gsap.set(el, { pointerEvents: 'none' })
      gsap.to(el, {
        autoAlpha: 0,
        y: -8,
        duration: 0.22,
        ease: 'power2.in',
        overwrite: true,
        onComplete: commit
      })
    },
    { scope: rootRef, dependencies: [pendingStage], revertOnUpdate: true }
  )

  // Stage entrance: the wrapper rises in and every `.card-enter` child
  // staggers after it — the GSAP replacement for the old CSS crossfade and
  // per-card animation-delay. Reduced motion renders the resting state.
  useGSAP(
    () => {
      if (stage === 'intro' || welcomeMotionReduced()) return
      const el = swapRef.current
      if (!el) return
      const tl = gsap.timeline({ defaults: { ease: CRIBBLE_EASE } })
      tl.fromTo(
        el,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.26 }
      )
      const cards = gsap.utils.toArray<HTMLElement>('.card-enter', el)
      if (cards.length > 0) {
        // y + autoAlpha only — an entrance scale rasterizes text mid-tween
        // and shimmers. clearProps hands the cards back to class-driven
        // styling afterwards, so .press-scale:active isn't overridden by a
        // leftover inline transform.
        tl.fromTo(
          cards,
          { autoAlpha: 0, y: 10 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.46,
            stagger: 0.045,
            clearProps: 'transform,opacity,visibility'
          },
          '<0.08'
        )
      }
    },
    { scope: rootRef, dependencies: [stage] }
  )

  useEffect(() => {
    // No src yet: constructing with the URL (plus preload) would start
    // the 1.2MB download on mount, even for users who bounce straight to
    // the dashboard. The src is attached on the first play attempt below.
    const ambience = new Audio()
    ambience.loop = true
    ambience.volume = 0.32
    ambience.preload = 'none'
    ambienceAudioRef.current = ambience
    return () => {
      ambience.pause()
      ambience.currentTime = 0
      ambienceAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const ambience = ambienceAudioRef.current
    if (!ambience) return
    if (stage !== 'intro') {
      // First play attempt attaches the src — this, not mount, is what
      // starts the download. Later stage changes leave it in place.
      if (!ambience.src) ambience.src = AMBIENCE_AUDIO_PATH
      ambience.play().catch(() => {
        // Browser autoplay policies may block until user gesture.
      })
    }
  }, [stage])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    devRequestedRef.current = params.has('dev')
    nextPathRef.current = sanitizeNextPath(params.get('next'))
    setCapableBrowser(isExtensionCapableBrowser())
    setBrowserFamily(currentExtensionBrowserFamily())
  }, [])

  useEffect(() => {
    let cancelled = false
    // Abort a hung request after 10s: the rejection lands in the catch
    // below, which fail-opens exactly like a network error, so the intro
    // always advances.
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      ONBOARDING_STATUS_TIMEOUT_MS
    )
    fetch('/api/user/onboarding', {
      credentials: 'include',
      signal: controller.signal
    })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          return { unauthenticated: true }
        }
        return r.ok ? r.json() : null
      })
      .then((data) => {
        if (cancelled) return
        if (data?.unauthenticated) {
          router.replace('/login')
          return
        }
        // ?dev=1 (stage jumper + replay) only works in local development —
        // never for any account in production.
        const dev = devRequestedRef.current && process.env.NODE_ENV === 'development'
        setDevMode(dev)
        if (data?.onboarded && !dev) setAlreadyOnboarded(true)
        setExtensionLinked(data?.extensionLinked === true)
        setAccountType(data?.metadata?.account_type === 'team' ? 'team' : 'solo')
        setSavedCountMode(parseCountMode(data?.metadata?.count_mode))
        setStatusKnown(true)
      })
      .catch(() => {
        if (!cancelled) setStatusKnown(true)
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [router])

  // The intro can branch as soon as the API status lands — except for
  // onboarded users behind a live extension step, who also need the first
  // handshake attempt settled before the gate verdict means anything.
  const gateReady =
    statusKnown && (!alreadyOnboarded || !EXTENSION_STEP_ENABLED || checked)

  // A live count-mode pick (this session) wins over the saved one.
  const effectiveCountMode = countMode ?? savedCountMode

  // signedIn is a given here: the status fetch above bounces unauthenticated
  // visitors to /login before the verdict is ever consulted.
  const verdict = evaluateExtensionGate({
    enabled: EXTENSION_STEP_ENABLED,
    signedIn: true,
    capableBrowser,
    detected,
    linked: extensionLinked,
    accountType,
    countMode: effectiveCountMode
  })

  // Leaving the flow is the one moment saved progress dies — a finished
  // session must never resume.
  const finish = useCallback(() => {
    clearWelcomeProgress()
    router.replace(nextPathRef.current ?? '/dashboard')
  }, [router])

  // Terminal navigation for the agent stage, which knows its own
  // destinations (Burn Board vs token dashboard).
  const finishTo = useCallback(
    (path: string) => {
      clearWelcomeProgress()
      router.replace(path)
    },
    [router]
  )

  // Restore a saved session: answers first, then the jump — the steps memo
  // recomputes from the restored count mode before the swap lands.
  const resumeFrom = useCallback(
    (saved: WelcomeProgress) => {
      setMode(saved.mode)
      setCountMode(saved.countMode)
      setRole(saved.role)
      setGoal(saved.goal)
      setTopTools(saved.topTools)
      setAgentProgress(saved.agent)
      goTo(saved.stage)
    },
    [goTo]
  )

  // Where the user goes once the intro settles. Resume beats replay: a
  // reload mid-flow restores the saved answers and lands back on the saved
  // stage. Dev mode always replays from scratch.
  const leaveIntro = useCallback(() => {
    const saved = devMode ? null : loadWelcomeProgress()
    // A saved extension stage is only real while the store listing is live.
    const resumable =
      saved !== null && (saved.stage !== 'extension' || EXTENSION_STEP_ENABLED)
        ? saved
        : null
    if (!alreadyOnboarded) {
      if (resumable) {
        resumeFrom(resumable)
        return
      }
      goTo('mode')
      return
    }
    // Onboarded but parked on a setup stage this sitting (the tools POST
    // fires before the extension/agent stages, so a reload there used to
    // bounce straight to the dashboard mid-setup): resume in place.
    if (
      resumable &&
      (resumable.stage === 'extension' || resumable.stage === 'agent') &&
      isProgressFresh(resumable)
    ) {
      resumeFrom(resumable)
      return
    }
    switch (verdict) {
      case 'allow':
        finish()
        return
      case 'install':
        goTo('extension')
        return
      default: {
        const exhaustive: never = verdict
        return exhaustive
      }
    }
  }, [alreadyOnboarded, devMode, verdict, finish, goTo, resumeFrom])

  // After the intro moment, branch on onboarding status + gate verdict.
  useEffect(() => {
    if (stage !== 'intro') return
    const id = setTimeout(() => {
      if (!gateReady) return // signals haven't settled yet — retry tick below
      leaveIntro()
    }, MIN_INTRO_MS)
    return () => clearTimeout(id)
  }, [stage, gateReady, leaveIntro])

  // Safety: if the signals settle outside the main timer's tick, still
  // advance — but never cut the brand moment short. Waiting only the
  // recheck delay used to race the minimum on fast connections and cut
  // the intro to half a second.
  useEffect(() => {
    if (stage !== 'intro' || !gateReady) return
    const elapsed = Date.now() - introStartedAtRef.current
    const wait = Math.max(INTRO_RECHECK_MS, MIN_INTRO_MS - elapsed)
    const t = setTimeout(leaveIntro, wait)
    return () => clearTimeout(t)
  }, [stage, gateReady, leaveIntro])

  // Persist every answer and the current stage as they change, so nothing
  // ever restarts from scratch. Session-scoped; the intro saves nothing.
  useEffect(() => {
    if (devMode || stage === 'intro') return
    saveWelcomeProgress({
      stage,
      mode,
      countMode,
      role,
      goal,
      topTools,
      agent: agentProgress,
      savedAt: Date.now()
    })
  }, [devMode, stage, mode, countMode, role, goal, topTools, agentProgress])

  // Active path. The `stage === 'team'` clause keeps the team list in
  // force during the leave animation after "Continue solo instead" flips
  // the mode — the counter must never dereference a stage that just left
  // the path. The wall and agent stages pin to a solo list that actually
  // contains them: an onboarded user can be routed straight to either one
  // (gate bounce, dev jumper) without a count mode picked this session.
  const steps = useMemo<Stage[]>(() => {
    if (stage === 'extension') {
      const list = soloSteps(effectiveCountMode)
      return list.includes('extension') ? list : soloSteps('browser')
    }
    if (stage === 'agent') {
      const list = soloSteps(effectiveCountMode)
      return list.includes('agent') ? list : soloSteps('tokens')
    }
    return stage === 'team' || mode === 'team'
      ? TEAM_STEPS
      : soloSteps(effectiveCountMode)
  }, [stage, mode, effectiveCountMode])

  const advance = useCallback(() => {
    const idx = steps.indexOf(stage)
    const next = steps[idx + 1]
    if (next) goTo(next)
  }, [steps, stage, goTo])

  const back = useCallback(() => {
    const idx = steps.indexOf(stage)
    if (idx > 0) goTo(steps[idx - 1])
  }, [steps, stage, goTo])

  // Save, then whatever the chosen lane puts after the questionnaire —
  // the extension wall, the agent link, or the dashboard directly. Saving
  // first means onboarding is already persisted even if the user bails on
  // a setup stage.
  const submit = useCallback(async () => {
    if (saving) return
    setSaving(true)
    if (!devMode) {
      try {
        await fetch('/api/user/onboarding', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            goal,
            topTools,
            accountType: mode,
            countMode,
            newsletter: false
          })
        })
      } catch {
        // intentionally swallow — we'd rather land the user than block them
      }
    }
    const next = steps[steps.indexOf('tools') + 1]
    if (next) {
      setSaving(false)
      goTo(next)
    } else {
      finish()
    }
  }, [role, goal, topTools, mode, countMode, saving, devMode, steps, finish, goTo])

  // The team lane's CTA: save-first (accountType lands even if the buyer
  // bails at Polar), then a plain browser navigation to the checkout
  // route — it redirects to Polar's hosted page, which router.push can't.
  const teamCheckout = useCallback(async () => {
    if (saving) return
    setSaving(true)
    if (!devMode) {
      try {
        await fetch('/api/user/onboarding', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountType: 'team',
            role: null,
            goal: null,
            topTools: [],
            newsletter: false
          })
        })
      } catch {
        // intentionally swallow — we'd rather open checkout than block them
      }
    }
    // saving stays true: the page is navigating away, and re-enabling the
    // button would just invite double-checkouts.
    window.location.href = `/api/checkout?type=team_${teamTerm}`
  }, [saving, devMode, teamTerm])

  // The escape hatch on the team stage: rejoin the solo path at the count
  // stage, so the signal choice is still made. steps recomputes to the
  // solo list once the swap lands on it.
  const continueSolo = useCallback(() => {
    setMode('solo')
    goTo('count')
  }, [goTo])

  // SKIP bails on the questionnaire but can't bypass the extension wall —
  // the (app) gate would just bounce back here, so land on the install
  // stage directly instead of looping through the dashboard. A tokens lane
  // still gets its agent stage (which has its own "Do this later" escape).
  // Skipping still counts as onboarding: fire the same save the completion
  // path makes (with whatever was answered so far) so onboarded_at is set
  // and the wizard doesn't replay on every future login. Fire-and-forget —
  // moving the user along matters more than the write.
  const skip = useCallback(() => {
    if (!devMode) {
      void fetch('/api/user/onboarding', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          goal,
          topTools,
          accountType: mode,
          countMode,
          newsletter: false
        })
      }).catch(() => {
        // intentionally swallow — we'd rather land the user than block them
      })
    }
    const list = soloSteps(effectiveCountMode)
    const next = list[list.indexOf('tools') + 1]
    if (next) {
      goTo(next)
      return
    }
    finish()
  }, [role, goal, topTools, mode, countMode, effectiveCountMode, devMode, goTo, finish])

  const stepNumber = useMemo(() => {
    if (stage === 'intro') return null
    return steps.indexOf(stage) + 1
  }, [steps, stage])

  // A first-run 'both' user continues from the wall to the agent stage; an
  // onboarded user bounced here by the gate goes straight through to the
  // app once the extension is detected. Only meaningful while the active
  // list actually contains the wall.
  const extensionIdx = steps.indexOf('extension')
  const extensionNext =
    alreadyOnboarded || extensionIdx === -1
      ? null
      : steps[extensionIdx + 1] ?? null

  const extensionDone = useCallback(() => {
    if (extensionNext) goTo(extensionNext)
    else finish()
  }, [extensionNext, goTo, finish])

  // The extension can't reach a tab that was already open when it was
  // installed, so one reload is genuinely required for the handshake.
  // Persist first: resume lands right back on this stage.
  const reloadAndCheck = useCallback(() => {
    if (!devMode && stage !== 'intro') {
      saveWelcomeProgress({
        stage,
        mode,
        countMode,
        role,
        goal,
        topTools,
        agent: agentProgress,
        savedAt: Date.now()
      })
    }
    window.location.reload()
  }, [devMode, stage, mode, countMode, role, goal, topTools, agentProgress])

  return (
    <div
      ref={rootRef}
      className="dossier-canvas min-h-screen bg-black text-zinc-100 relative overflow-hidden selection:bg-accent/20"
    >
      <SpaceBackdrop />

      {devMode && (
        <DevBar
          stages={DEV_STAGES}
          stage={stage}
          onJump={(s) => {
            // Discard any in-flight leave tween so its commit can't yank
            // the jump back to a stale target.
            setPendingStage(null)
            setStage(s)
          }}
        />
      )}

      <div className="relative z-10 min-h-screen flex flex-col">
        {stage !== 'intro' && (
          <TopBar
            stepNumber={stepNumber}
            totalSteps={steps.length}
            onSkip={stage === 'extension' || stage === 'agent' ? null : skip}
          />
        )}

        <main className="flex-1 flex items-center justify-center px-6 py-10">
          {stage === 'intro' ? (
            <IntroStage />
          ) : (
            <div
              key={stage}
              ref={swapRef}
              className="w-full flex justify-center"
            >
              {stage === 'mode' && (
                <ModeStage
                  step={stepNumber ?? 1}
                  value={mode}
                  onChange={setMode}
                  onNext={advance}
                />
              )}
              {stage === 'team' && (
                <TeamStage
                  step={stepNumber ?? 2}
                  term={teamTerm}
                  onTermChange={setTeamTerm}
                  saving={saving}
                  onCheckout={() => void teamCheckout()}
                  onContinueSolo={continueSolo}
                  onBack={back}
                />
              )}
              {stage === 'count' && (
                <CountStage
                  step={stepNumber ?? 2}
                  value={countMode}
                  onChange={setCountMode}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'privacy' && (
                <PrivacyStage
                  step={stepNumber ?? 3}
                  countMode={effectiveCountMode}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'role' && (
                <RoleStage
                  step={stepNumber ?? 4}
                  value={role}
                  onChange={setRole}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'goal' && (
                <GoalStage
                  step={stepNumber ?? 5}
                  value={goal}
                  onChange={setGoal}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'tools' && (
                <ToolsStage
                  step={stepNumber ?? 6}
                  value={topTools}
                  onChange={setTopTools}
                  onSubmit={submit}
                  onBack={back}
                  saving={saving}
                  finalStep={steps[steps.indexOf('tools') + 1] === undefined}
                />
              )}
              {stage === 'extension' && (
                <ExtensionStage
                  step={stepNumber ?? 7}
                  detected={detected}
                  capableBrowser={capableBrowser}
                  browserFamily={browserFamily}
                  canEnter={verdict === 'allow'}
                  finalStep={extensionNext === null}
                  onDone={extensionDone}
                  onReloadCheck={reloadAndCheck}
                />
              )}
              {stage === 'agent' && (
                <AgentLinkStage
                  step={stepNumber ?? steps.length}
                  initialProgress={agentProgress}
                  onProgress={setAgentProgress}
                  onFinish={finishTo}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        /* Selection check keeps its pop, without overshoot. */
        @keyframes welcome-check-pop {
          from {
            opacity: 0;
            transform: scale(0.4);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .check-pop {
          animation: welcome-check-pop 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        /* Phosphor selection — green as light, not paint. A vertical wash
           falls from the top edge over the card's own ink, one faint bloom
           lifts it off the backdrop, and two dossier corner ticks (the
           dashboard's bracket motif) mark the live choice. Everything rides
           --accent-rgb, so light mode inherits its orange automatically. */
        .phos-selected {
          background-image: linear-gradient(
            180deg,
            rgb(var(--accent-rgb) / 0.07),
            transparent 45%
          );
          box-shadow: 0 0 24px rgb(var(--accent-rgb) / 0.08);
        }
        .phos-selected::after {
          content: '';
          position: absolute;
          inset: 7px;
          pointer-events: none;
          --tick: rgb(var(--accent-rgb) / 0.6);
          background-image: linear-gradient(var(--tick), var(--tick)),
            linear-gradient(var(--tick), var(--tick)),
            linear-gradient(var(--tick), var(--tick)),
            linear-gradient(var(--tick), var(--tick));
          background-size: 10px 1px, 1px 10px, 10px 1px, 1px 10px;
          background-position: 0 0, 0 0, 100% 100%, 100% 100%;
          background-repeat: no-repeat;
        }

        /* CRT status light — the check reads as an indicator, not a
           sticker: dark chip, hairline ring, glowing glyph. */
        .phos-check svg {
          filter: drop-shadow(0 0 6px rgb(var(--accent-rgb) / 0.7));
        }

        /* Progress rail — filled segments fade toward the tip and cast a
           soft under-glow; the current segment breathes. */
        .rail-fill {
          background: linear-gradient(
            90deg,
            rgb(var(--accent-rgb)),
            rgb(var(--accent-rgb) / 0.4)
          );
          box-shadow: 0 1px 6px rgb(var(--accent-rgb) / 0.3);
        }
        @keyframes welcome-rail-breathe {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
        .rail-breathe {
          animation: welcome-rail-breathe 2.4s ease-in-out infinite;
        }

        /* Hover never lifts (border/luminance changes only); a press
           compresses like a control. */
        .press-scale:not(:disabled):active {
          transform: scale(0.985);
        }
        .cta-brighten:not(:disabled):hover {
          box-shadow: 0 0 20px rgb(255 255 255 / 0.22);
        }
        html.light .cta-brighten:not(:disabled):hover {
          box-shadow: 0 4px 18px rgb(9 9 11 / 0.25);
        }

        @keyframes welcome-note-in {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
        }
        .note-enter {
          animation: welcome-note-in 320ms ease-out both;
        }

        /* Intro choreography */
        @keyframes intro-rise {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .intro-rise {
          animation: intro-rise 800ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--wd, 0ms);
        }

        @keyframes intro-line {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
        .intro-line {
          transform-origin: left center;
          animation: intro-line 1.5s cubic-bezier(0.65, 0, 0.35, 1) 400ms both;
        }

        @media (prefers-reduced-motion: reduce) {
          .check-pop,
          .note-enter,
          .intro-rise,
          .intro-line,
          .rail-breathe {
            animation: none;
          }
          .press-scale:not(:disabled):active {
            transform: none;
          }
        }
      `}</style>
    </div>
  )
}

/* ============================================================
   DEV BAR — stage jumper, only shown with ?dev=1 for allowed accounts
   ============================================================ */

function DevBar({
  stages,
  stage,
  onJump
}: {
  /** The full stage union, not the active path — every onboarding lane
   *  must be reachable without re-answering the questionnaire. */
  stages: Stage[]
  stage: Stage
  onJump: (s: Stage) => void
}) {
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/90 backdrop-blur px-2 py-1.5 font-mono">
      <span className="text-[9px] tracking-[0.3em] text-zinc-600 px-1">DEV</span>
      {stages.map((s) => (
        <button
          key={s}
          onClick={() => onJump(s)}
          className={`text-[9px] tracking-[0.2em] uppercase px-2 py-1 rounded transition-colors ${
            stage === s ? 'text-accent bg-accent/10' : 'text-zinc-500'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

/* ============================================================
   TOP BAR — wordmark, step counter, segmented progress, skip
   ============================================================ */

function TopBar({
  stepNumber,
  totalSteps,
  onSkip
}: {
  stepNumber: number | null
  totalSteps: number
  /** null hides the button — the extension wall is mandatory and the
   *  agent stage carries its own "Do this later" escape. */
  onSkip: (() => void) | null
}) {
  return (
    <header className="relative z-10 px-6 pt-6">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5 font-mono text-sm tracking-[0.4em] text-zinc-100 font-semibold">
          <LiquidMark size={22} />
          <span>
            CRIBBLE<span className="text-accent">.</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block font-mono text-[10px] tracking-[0.3em] text-zinc-500 tabular-nums">
            {String(stepNumber ?? 0).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
          </div>
          <ThemeToggle />
          {onSkip && (
            <button
              onClick={onSkip}
              className="press-scale font-mono text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              SKIP
            </button>
          )}
        </div>
      </div>
      <div className="mt-5 max-w-3xl mx-auto flex gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className="h-[3px] flex-1 rounded-full bg-zinc-900"
          >
            <div
              className={`h-full rounded-full rail-fill transition-transform duration-500 ease-out origin-left ${
                stepNumber !== null && i < stepNumber ? 'scale-x-100' : 'scale-x-0'
              } ${stepNumber !== null && i === stepNumber - 1 ? 'rail-breathe' : ''}`}
            />
          </div>
        ))}
      </div>
    </header>
  )
}

/* ============================================================
   INTRO — brief brand moment while onboarding status loads
   ============================================================ */

function IntroStage() {
  return (
    <div className="relative w-full max-w-md px-2 text-center">
      <div
        className="intro-rise mx-auto mb-7 flex justify-center"
        style={{ ['--wd' as string]: '0ms' }}
      >
        <LiquidMark size={88} title="Cribble" />
      </div>
      <div
        className="intro-rise font-mono text-[10px] tracking-[0.5em] text-zinc-500"
        style={{ ['--wd' as string]: '60ms' }}
      >
        WELCOME TO
      </div>
      <div
        className="intro-rise mt-4 font-mono text-3xl md:text-4xl tracking-[0.3em] font-semibold text-zinc-50"
        style={{ ['--wd' as string]: '120ms' }}
      >
        CRIBBLE<span className="text-accent">.</span>
      </div>
      <div
        className="intro-rise mt-5 font-serif text-xl md:text-2xl text-zinc-400"
        style={{ ['--wd' as string]: '320ms' }}
      >
        Time in AI tools. Counted.
      </div>
      <div className="mt-12 mx-auto h-px w-44 bg-zinc-900 overflow-hidden rounded-full">
        <div className="intro-line h-full w-full bg-accent/80" />
      </div>
    </div>
  )
}

/* ============================================================
   Solo or Team
   ============================================================ */

function ModeStage({
  step,
  value,
  onChange,
  onNext
}: {
  step: number
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
}) {
  return (
    <StageShell
      step={step}
      stage="mode"
      title="How will you play?"
      subtitle="Your own board, or your company's mark on it."
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        <ChoiceCard
          selected={value === 'solo'}
          onClick={() => onChange('solo')}
          large
        >
          <CardIcon icon={IconSolo} selected={value === 'solo'} />
          <div className="mt-4 text-base font-semibold text-zinc-100">Solo</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
            Track your own usage, keep your streak alive and climb the global
            leaderboard.
          </p>
        </ChoiceCard>

        <ChoiceCard
          selected={value === 'team'}
          onClick={() => onChange('team')}
          large
        >
          <CardIcon icon={IconTeam} selected={value === 'team'} />
          <div className="mt-4 text-base font-semibold text-zinc-100">Team</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
            Play as your company: the gold badge, the square avatar, and up
            to 10 affiliated pilots wearing your mark on the board.
          </p>
        </ChoiceCard>
      </div>

      <StageActions>
        <PrimaryButton onClick={onNext} disabled={!value}>
          Continue
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   Team path — the company plan: pitch, term, checkout
   ============================================================ */

const TEAM_TERM_ORDER: BillingTerm[] = ['monthly', 'yearly']

function TeamStage({
  step,
  term,
  onTermChange,
  saving,
  onCheckout,
  onContinueSolo,
  onBack
}: {
  step: number
  term: BillingTerm
  onTermChange: (t: BillingTerm) => void
  saving: boolean
  onCheckout: () => void
  onContinueSolo: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={step}
      stage="team"
      title="Fly your company's colors."
      subtitle="One account becomes the team. It carries the mark, your pilots carry it onto the board, and everyone keeps their own solo profile."
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* the pitch — three lines, gold checks */}
        <div className="card-enter glass-lite rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <span style={{ color: `rgb(${GOLD})` }}>
              <IconTeam size={17} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              WHAT THE PLAN UNLOCKS
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            <TeamPerkItem text="The gold team badge on your callsign, every surface" />
            <TeamPerkItem text="The square avatar: a company mark, not a face" />
            <TeamPerkItem text="Up to 10 affiliated pilots wearing your mark on the board" />
          </ul>
        </div>

        {/* the term — prices come from planTerms, never hardcoded here */}
        <div className="flex flex-col gap-3">
          {TEAM_TERM_ORDER.map((t) => {
            const meta = TEAM_TERMS[t]
            const selected = term === t
            return (
              <ChoiceCard
                key={t}
                selected={selected}
                onClick={() => onTermChange(t)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-zinc-400">
                    {t}
                  </span>
                  {t === 'yearly' && (
                    <span
                      className={`font-mono text-[9px] tracking-[0.25em] px-2 py-1 rounded-full border ${
                        selected ? 'mr-8' : ''
                      }`}
                      style={{
                        color: `rgb(${GOLD})`,
                        borderColor: `rgb(${GOLD} / 0.4)`,
                        background: `rgb(${GOLD} / 0.07)`
                      }}
                    >
                      2 MONTHS FREE
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-zinc-50">
                    {meta.price}
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.25em] text-zinc-500">
                    {meta.unit}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-[9px] tracking-[0.2em] text-zinc-500">
                  {meta.context}
                </div>
                <p className="sr-only">{meta.announce}</p>
              </ChoiceCard>
            )
          })}
        </div>
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-zinc-500">
        <span style={{ color: `rgb(${GOLD})` }}>*</span> Payment is followed
        by hand identity verification. The badge unlocks on approval, within
        24 hours.
      </p>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <GhostButton onClick={onContinueSolo} noIcon>
          Continue solo instead
        </GhostButton>
        <PrimaryButton onClick={onCheckout} disabled={saving}>
          {saving ? 'Opening checkout…' : 'Field your team'}
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

function TeamPerkItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-snug text-zinc-300">
      <span className="mt-[2px] shrink-0" style={{ color: `rgb(${GOLD})` }}>
        <IconCheck size={14} />
      </span>
      <span>{text}</span>
    </li>
  )
}

/* ============================================================
   Privacy reassurance — the copy follows the chosen count mode
   ============================================================ */

function privacyContent(countMode: CountMode | null): {
  title: React.ReactNode
  subtitle: string
  collect: string[]
  never: string[]
} {
  const mode = countMode ?? 'browser'
  switch (mode) {
    case 'browser':
      return {
        title: (
          <>
            We count <em className="text-zinc-50">showing up</em>, not what
            you say.
          </>
        ),
        subtitle:
          'The extension only measures which AI tools you visit and for how long. It never reads what you type, what the model says back, or your chat history.',
        collect: [
          'Domains you visit (chatgpt.com, claude.ai, …)',
          'Active vs idle minutes per tab',
          'Number of visits per tool',
          'Sync timestamps for streak math'
        ],
        never: [
          'Your prompts. Ever.',
          "The model's responses",
          'Your chat history or files',
          'Keystrokes, clipboard, screens'
        ]
      }
    case 'tokens':
      return {
        title: (
          <>
            We count <em className="text-zinc-50">the burn</em>, not your
            code.
          </>
        ),
        subtitle:
          "The CLI reads your coding agents' local usage stats and syncs daily token totals. It never reads your code, your prompts, or what the model wrote back.",
        collect: [
          'Daily token totals per agent and model',
          'Estimated cost of those tokens',
          'The machine name you give each key',
          'Sync timestamps for freshness'
        ],
        never: [
          'Your code or diffs. Ever.',
          'Prompts or model responses',
          'File paths or repo names',
          'Anything else on your machine'
        ]
      }
    case 'both':
      return {
        title: (
          <>
            We count <em className="text-zinc-50">signals</em>, not what you
            say.
          </>
        ),
        subtitle:
          'The extension measures which AI tools you visit and for how long; the CLI syncs daily token totals from your coding agents. Neither reads what you type or what the model says back.',
        collect: [
          'Domains you visit and active minutes',
          'Daily token totals per agent and model',
          'Estimated cost of the burn',
          'Sync timestamps for streak math'
        ],
        never: [
          'Your prompts or code. Ever.',
          "The model's responses",
          'Your chat history or files',
          'Keystrokes, clipboard, screens'
        ]
      }
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

function PrivacyStage({
  step,
  countMode,
  onNext,
  onBack
}: {
  step: number
  countMode: CountMode | null
  onNext: () => void
  onBack: () => void
}) {
  const copy = privacyContent(countMode)
  return (
    <StageShell
      step={step}
      stage="privacy"
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card-enter glass-lite rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <IconActivity size={17} className="text-accent" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              WHAT WE COLLECT
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            {copy.collect.map((text) => (
              <PrivacyItem key={text} text={text} />
            ))}
          </ul>
        </div>
        <div className="card-enter glass-lite rounded-2xl p-6">
          <div className="flex items-center gap-2.5">
            <IconShieldCheck size={17} className="text-zinc-300" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              WHAT WE NEVER TOUCH
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            {copy.never.map((text) => (
              <PrivacyItem key={text} cross text={text} />
            ))}
          </ul>
        </div>
      </div>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

function PrivacyItem({ text, cross }: { text: string; cross?: boolean }) {
  return (
    <li className="flex items-start gap-3 text-[13px] leading-snug text-zinc-300">
      {cross ? (
        <IconX size={14} className="mt-[2px] shrink-0 text-zinc-600" />
      ) : (
        <IconCheck size={14} className="mt-[2px] shrink-0 text-accent" />
      )}
      <span>{text}</span>
    </li>
  )
}

/* ============================================================
   Role
   ============================================================ */

function RoleStage({
  step,
  value,
  onChange,
  onNext,
  onBack
}: {
  step: number
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={step}
      stage="role"
      title="What do you do?"
      subtitle="Used for recaps and the board. Change it later in your profile."
    >
      <div className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {ROLES.map((r) => (
          <ChoiceCard
            key={r.id}
            selected={value === r.id}
            onClick={() => onChange(r.id)}
          >
            <CardIcon icon={r.icon} selected={value === r.id} />
            <div className="mt-3.5 text-sm font-semibold text-zinc-100">
              {r.label}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">{r.hint}</div>
          </ChoiceCard>
        ))}
      </div>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext} disabled={!value}>
          Continue
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   Goal
   ============================================================ */

function GoalStage({
  step,
  value,
  onChange,
  onNext,
  onBack
}: {
  step: number
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={step}
      stage="goal"
      title="What is this for?"
      subtitle="The main reason you open these tools."
    >
      <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {GOALS.map((g) => (
          <ChoiceCard
            key={g.id}
            selected={value === g.id}
            onClick={() => onChange(g.id)}
          >
            <div className="flex items-center gap-3">
              <CardIcon icon={g.icon} selected={value === g.id} />
              <div>
                <div className="text-sm font-semibold text-zinc-100">
                  {g.label}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">{g.hint}</div>
              </div>
            </div>
          </ChoiceCard>
        ))}
      </div>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext} disabled={!value}>
          Continue
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   Top tools (multi-select), the questionnaire's last stop
   ============================================================ */

function ToolsStage({
  step,
  value,
  onChange,
  onSubmit,
  onBack,
  saving,
  finalStep
}: {
  step: number
  value: string[]
  onChange: (v: string[]) => void
  onSubmit: () => void
  onBack: () => void
  saving: boolean
  /** True when nothing follows on the active path — only then may the CTA
   *  promise the dashboard. */
  finalStep: boolean
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id))
    else if (value.length < 4) onChange([...value, id])
  }

  const ctaLabel = finalStep ? 'Enter dashboard' : 'Continue'
  const busyLabel = finalStep ? 'Opening dashboard…' : 'Saving…'

  return (
    <StageShell
      step={step}
      stage="tools"
      title="Which tools do you open most?"
      subtitle={`Up to four. The rest shows up once tracking is on. ${value.length}/4`}
    >
      <div className="mt-9 space-y-6">
        {TOOL_GROUPS.map((group, groupIdx) => (
          <div key={group.label ?? `ungrouped-${groupIdx}`}>
            {group.label && (
              <div className="mb-2.5 font-mono text-[9px] tracking-[0.3em] text-zinc-600">
                {group.label}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {group.tools.map((t) => {
                const selected = value.includes(t.id)
                const atCap = !selected && value.length >= 4
                return (
                  <ChoiceCard
                    key={t.id}
                    selected={selected}
                    onClick={() => !atCap && toggle(t.id)}
                    disabled={atCap}
                  >
                    <div className="flex items-center gap-3">
                      <CardIcon icon={t.icon} selected={selected} />
                      <span className="text-sm font-semibold text-zinc-100">
                        {t.label}
                      </span>
                    </div>
                  </ChoiceCard>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onSubmit} disabled={saving}>
          {saving ? busyLabel : ctaLabel}
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   Install the extension (only when the store listing is live)
   ============================================================ */

function ExtensionStage({
  step,
  detected,
  capableBrowser,
  browserFamily,
  canEnter,
  finalStep,
  onDone,
  onReloadCheck
}: {
  step: number
  detected: boolean
  capableBrowser: boolean
  /** Store card to highlight — null (Safari, Edge, mobile, SSR)
   *  highlights none. Cosmetic only: every card stays a plain link
   *  either way. */
  browserFamily: ExtensionBrowserFamily | null
  /** Gate verdict for the current inputs — the CTA stays locked until it
   *  passes. Detection landing mid-stage unlocks it by itself, since the
   *  page-level hook keeps polling. */
  canEnter: boolean
  /** False on the 'both' lane, where the agent-link stage still follows. */
  finalStep: boolean
  onDone: () => void
  /** Persists progress, then reloads — session resume lands right back
   *  here, so the required post-install reload costs nothing. */
  onReloadCheck: () => void
}) {
  // Detection landing forwards on its own after a short confirmation beat;
  // the button below stays as the manual fallback.
  useEffect(() => {
    if (!detected || !canEnter) return
    const id = window.setTimeout(onDone, EXTENSION_DETECTED_PAUSE_MS)
    return () => window.clearTimeout(id)
  }, [detected, canEnter, onDone])

  return (
    <StageShell
      step={step}
      stage="extension"
      title="Install cribble-engine."
      subtitle="Cribble cannot count browser time until this is on. It measures which tools you open and for how long. Not what you type."
    >
      <div
        className={`mt-9 grid grid-cols-1 gap-3 ${
          EXTENSION_STORES.length > 1 ? 'md:grid-cols-2' : ''
        }`}
      >
        {EXTENSION_STORES.map((store) => (
          <StoreCard
            key={store.family}
            store={store}
            highlighted={store.family === browserFamily}
          />
        ))}
      </div>

      <div
        className="card-enter glass-lite mt-3 rounded-2xl px-6 py-5"
        style={{
          borderColor: detected ? 'rgb(var(--accent-rgb) / 0.5)' : undefined
        }}
      >
        {detected ? (
          <div className="flex items-center gap-3">
            <span className="check-pop phos-check inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 bg-zinc-950 text-accent">
              <IconCheck size={11} />
            </span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-accent">
              EXTENSION DETECTED
            </span>
          </div>
        ) : capableBrowser ? (
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-5 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
                WAITING FOR INSTALL…
              </span>
            </div>
            <p className="mt-2 pl-8 text-xs leading-relaxed text-zinc-600">
              Installed but not detected? The extension can&apos;t reach a
              tab that was already open. One reload connects it.
            </p>
            <button
              type="button"
              onClick={onReloadCheck}
              className="press-scale mt-3 ml-8 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              RELOAD AND CHECK
            </button>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-zinc-500">
            The extension isn&apos;t available for this browser yet. Open
            Cribble on desktop {installableBrowserNames()} to install.
          </p>
        )}
      </div>

      <StageActions>
        <PrimaryButton onClick={onDone} disabled={!canEnter} emphasized={canEnter}>
          {finalStep ? 'Enter dashboard' : 'Continue'}
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/** Store link card — a plain external link, never a radio: installing is
 *  proven by the detection handshake, not by clicking. The highlight marks
 *  the card matching the running browser. */
function StoreCard({
  store,
  highlighted
}: {
  store: ExtensionStore
  highlighted: boolean
}) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`card-enter press-scale relative block rounded-2xl border bg-zinc-950/70 p-5 transition-[border-color,background-color,box-shadow,color] duration-300 ${
        highlighted
          ? 'phos-selected border-accent/25'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      {highlighted && (
        <span className="absolute top-3 right-3 rounded-full border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[9px] tracking-[0.25em] text-accent">
          THIS BROWSER
        </span>
      )}
      <div className="flex items-center gap-4">
        <CardIcon icon={store.icon} selected={highlighted} />
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            {store.cta}
            <IconArrowRight size={13} className="text-zinc-500" />
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">{store.storeName}</div>
        </div>
      </div>
    </a>
  )
}
