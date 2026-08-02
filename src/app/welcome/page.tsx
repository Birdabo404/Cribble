'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LiquidMark } from '@/components/brand/LiquidMark'
import { ROLE_ICONS } from '@/components/roleIcons'
import { ROLE_OPTIONS } from '@/lib/roles'
import { EXTENSION_INSTALL_URL } from '@/lib/extensionInstall'
import { TEAM_TERMS, type BillingTerm } from '@/lib/planTerms'
import { useExtensionDetection } from '@/hooks/useExtensionDetection'
import {
  BrandClaude,
  BrandCopilot,
  BrandCursor,
  BrandGemini,
  BrandMidjourney,
  BrandOpenAI,
  BrandPerplexity,
  IconActivity,
  IconArrowLeft,
  IconArrowRight,
  IconAsterisk,
  IconBookOpen,
  IconCheck,
  IconGrid,
  IconMicroscope,
  IconOrbit,
  IconPuzzle,
  IconShieldCheck,
  IconSolo,
  IconSparkles,
  IconTeam,
  IconWrench,
  IconX,
  IconZap,
  type IconProps
} from '@/components/welcome/icons'

type Stage =
  | 'intro'
  | 'mode'
  | 'team'
  | 'privacy'
  | 'role'
  | 'goal'
  | 'tools'
  | 'extension'

// EXTENSION_INSTALL_URL is a build-time env constant, so the solo step list
// can be fixed once at module level: no store listing → no extension step,
// and the wizard behaves exactly as it did before that step existed.
const EXTENSION_STEP_ENABLED = EXTENSION_INSTALL_URL !== null

// The step list is a function of the chosen mode. Solo runs the personal
// questionnaire; team is a two-step lane — the remaining questions are
// extension- and person-centric, and a company account tracks nothing.
const SOLO_STEPS: Stage[] = EXTENSION_STEP_ENABLED
  ? ['mode', 'privacy', 'role', 'goal', 'tools', 'extension']
  : ['mode', 'privacy', 'role', 'goal', 'tools']

const TEAM_STEPS: Stage[] = ['mode', 'team']

const STEP_META: Record<
  Exclude<Stage, 'intro'>,
  { eyebrow: string }
> = {
  mode: { eyebrow: 'Account' },
  team: { eyebrow: 'Your team' },
  privacy: { eyebrow: 'Privacy' },
  role: { eyebrow: 'About you' },
  goal: { eyebrow: 'Mission' },
  tools: { eyebrow: 'Loadout' },
  extension: { eyebrow: 'Extension' }
}

/** Gold is the team plan's hue everywhere (console, /teams, badges) —
 *  used sparingly here as an accent inside the wizard's own language. */
const GOLD = 'var(--lb-gold)'

type IconComponent = (p: IconProps) => JSX.Element

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
  { id: 'work', label: 'Work faster', hint: 'crush daily output', icon: IconZap },
  { id: 'hobby', label: 'Stay curious', hint: 'no agenda, just vibes', icon: IconOrbit },
  { id: 'other', label: 'Something else', hint: 'tell us later', icon: IconAsterisk }
]

const TOOLS: { id: string; label: string; icon: IconComponent }[] = [
  { id: 'chatgpt', label: 'ChatGPT', icon: BrandOpenAI },
  { id: 'claude', label: 'Claude', icon: BrandClaude },
  { id: 'gemini', label: 'Gemini', icon: BrandGemini },
  { id: 'perplexity', label: 'Perplexity', icon: BrandPerplexity },
  { id: 'cursor', label: 'Cursor', icon: BrandCursor },
  { id: 'copilot', label: 'Copilot', icon: BrandCopilot },
  { id: 'midjourney', label: 'Midjourney', icon: BrandMidjourney },
  { id: 'other', label: 'Other', icon: IconGrid }
]

const AMBIENCE_AUDIO_PATH = '/audio/deeper-into-it.mp3'

const STEP_SWAP_MS = 240

export default function WelcomePage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('intro')
  const [leaving, setLeaving] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [goal, setGoal] = useState<string | null>(null)
  const [topTools, setTopTools] = useState<string[]>([])
  // Yearly leads, same as every other team surface: the honest default is
  // the best deal.
  const [teamTerm, setTeamTerm] = useState<BillingTerm>('yearly')
  const [saving, setSaving] = useState(false)
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false)
  const [statusKnown, setStatusKnown] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const devRequestedRef = useRef(false)
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null)
  const swapTimerRef = useRef<number | null>(null)

  // Crossfade between steps: animate the current step out, then swap.
  const goTo = useCallback((next: Stage) => {
    setLeaving(true)
    if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current)
    swapTimerRef.current = window.setTimeout(() => {
      setStage(next)
      setLeaving(false)
    }, STEP_SWAP_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const ambience = new Audio(AMBIENCE_AUDIO_PATH)
    ambience.loop = true
    ambience.volume = 0.32
    ambience.preload = 'auto'
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
      ambience.play().catch(() => {
        // Browser autoplay policies may block until user gesture.
      })
    }
  }, [stage])

  useEffect(() => {
    devRequestedRef.current = new URLSearchParams(window.location.search).has('dev')
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/onboarding', { credentials: 'include' })
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
        setStatusKnown(true)
      })
      .catch(() => {
        if (!cancelled) setStatusKnown(true)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  // After the intro moment, branch on whether the user is already onboarded.
  useEffect(() => {
    if (stage !== 'intro') return
    const minIntro = 1800
    const id = setTimeout(() => {
      if (!statusKnown) return // status hasn't returned yet — retry tick below
      if (alreadyOnboarded) router.replace('/dashboard')
      else goTo('mode')
    }, minIntro)
    return () => clearTimeout(id)
  }, [stage, alreadyOnboarded, statusKnown, router, goTo])

  // Safety: if status arrives later than the intro minimum, still advance.
  useEffect(() => {
    if (stage !== 'intro' || !statusKnown) return
    const t = setTimeout(() => {
      if (alreadyOnboarded) router.replace('/dashboard')
      else goTo('mode')
    }, 200)
    return () => clearTimeout(t)
  }, [statusKnown, alreadyOnboarded, stage, router, goTo])

  // Active path. The `stage === 'team'` clause keeps the team list in
  // force during the leave animation after "Continue solo instead" flips
  // the mode — the counter must never dereference a stage that just left
  // the path.
  const steps = useMemo<Stage[]>(
    () => (stage === 'team' || mode === 'team' ? TEAM_STEPS : SOLO_STEPS),
    [stage, mode]
  )

  const advance = useCallback(() => {
    const idx = steps.indexOf(stage)
    const next = steps[idx + 1]
    if (next) goTo(next)
  }, [steps, stage, goTo])

  const back = useCallback(() => {
    const idx = steps.indexOf(stage)
    if (idx > 0) goTo(steps[idx - 1])
  }, [steps, stage, goTo])

  // Save, then either the extension step (when a store listing is live) or
  // straight to the dashboard. Saving first means onboarding is already
  // persisted even if the user bails on the extension step.
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
            newsletter: false
          })
        })
      } catch {
        // intentionally swallow — we'd rather land the user than block them
      }
    }
    if (EXTENSION_STEP_ENABLED) {
      setSaving(false)
      goTo('extension')
    } else {
      router.replace('/dashboard')
    }
  }, [role, goal, topTools, mode, saving, devMode, router, goTo])

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

  // The escape hatch on the team stage: rejoin the solo path at privacy.
  // steps recomputes to the solo list once the crossfade lands on it.
  const continueSolo = useCallback(() => {
    setMode('solo')
    goTo('privacy')
  }, [goTo])

  const skip = useCallback(() => {
    router.replace('/dashboard')
  }, [router])

  const stepNumber = useMemo(() => {
    if (stage === 'intro') return null
    return steps.indexOf(stage) + 1
  }, [steps, stage])

  return (
    <div className="dossier-canvas min-h-screen bg-black text-zinc-100 relative overflow-hidden selection:bg-accent/20">
      <SpaceBackdrop />

      {devMode && <DevBar stages={['intro', ...steps]} stage={stage} onJump={setStage} />}

      <div className="relative z-10 min-h-screen flex flex-col">
        {stage !== 'intro' && (
          <TopBar
            stepNumber={stepNumber}
            totalSteps={steps.length}
            onSkip={skip}
          />
        )}

        <main className="flex-1 flex items-center justify-center px-6 py-10">
          {stage === 'intro' ? (
            <IntroStage />
          ) : (
            <div
              key={stage}
              className={`w-full flex justify-center ${
                leaving ? 'step-leave' : 'step-enter'
              }`}
            >
              {stage === 'mode' && (
                <ModeStage value={mode} onChange={setMode} onNext={advance} />
              )}
              {stage === 'team' && (
                <TeamStage
                  term={teamTerm}
                  onTermChange={setTeamTerm}
                  saving={saving}
                  onCheckout={() => void teamCheckout()}
                  onContinueSolo={continueSolo}
                  onBack={back}
                />
              )}
              {stage === 'privacy' && (
                <PrivacyStage onNext={advance} onBack={back} />
              )}
              {stage === 'role' && (
                <RoleStage
                  value={role}
                  onChange={setRole}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'goal' && (
                <GoalStage
                  value={goal}
                  onChange={setGoal}
                  onNext={advance}
                  onBack={back}
                />
              )}
              {stage === 'tools' && (
                <ToolsStage
                  value={topTools}
                  onChange={setTopTools}
                  onSubmit={submit}
                  onBack={back}
                  saving={saving}
                />
              )}
              {stage === 'extension' && <ExtensionStage onDone={skip} />}
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        @keyframes welcome-step-in {
          from {
            opacity: 0;
            transform: translateY(14px);
            filter: blur(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }
        .step-enter {
          animation: welcome-step-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @keyframes welcome-step-out {
          to {
            opacity: 0;
            transform: translateY(-10px);
            filter: blur(5px);
          }
        }
        .step-leave {
          animation: welcome-step-out ${STEP_SWAP_MS}ms ease-in both;
          pointer-events: none;
        }

        /* Per-card entrance — rides the step swap with a small stagger. */
        @keyframes welcome-card-in {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .card-enter {
          animation: welcome-card-in 460ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--wd, 0ms);
        }

        /* Selection check pops in with a slight overshoot. */
        @keyframes welcome-check-pop {
          from {
            opacity: 0;
            transform: scale(0.4);
          }
          70% {
            transform: scale(1.15);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .check-pop {
          animation: welcome-check-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
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
            filter: blur(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
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
          .step-enter,
          .step-leave,
          .card-enter,
          .check-pop,
          .note-enter,
          .intro-rise,
          .intro-line {
            animation: none;
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
  /** The active path's stages — the jumper follows the chosen mode. */
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
  onSkip: () => void
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
          <button
            onClick={onSkip}
            className="font-mono text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            SKIP
          </button>
        </div>
      </div>
      <div className="mt-5 max-w-3xl mx-auto flex gap-1.5">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className="h-[3px] flex-1 rounded-full bg-zinc-900 overflow-hidden"
          >
            <div
              className={`h-full rounded-full bg-accent transition-transform duration-500 ease-out origin-left ${
                stepNumber !== null && i < stepNumber ? 'scale-x-100' : 'scale-x-0'
              }`}
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
        your AI grind, <em className="text-zinc-200">on the record</em>.
      </div>
      <div className="mt-12 mx-auto h-px w-44 bg-zinc-900 overflow-hidden rounded-full">
        <div className="intro-line h-full w-full bg-accent/80" />
      </div>
    </div>
  )
}

/* ============================================================
   STEP 1 — Solo or Team
   ============================================================ */

function ModeStage({
  value,
  onChange,
  onNext
}: {
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
}) {
  return (
    <StageShell
      step={1}
      stage="mode"
      title={
        <>
          how will you <em className="text-zinc-50">play</em>?
        </>
      }
      subtitle="Cribble tracks your time inside AI tools and turns it into a score. Compete on your own, or represent your company."
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        <ChoiceCard
          selected={value === 'solo'}
          onClick={() => onChange('solo')}
          index={0}
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
          index={1}
          large
        >
          <CardIcon icon={IconTeam} selected={value === 'team'} />
          <div className="mt-4 text-base font-semibold text-zinc-100">Team</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
            Play as your company — the gold badge, the square avatar, and up
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
   STEP 2 (team path) — the company plan: pitch, term, checkout
   ============================================================ */

const TEAM_TERM_ORDER: BillingTerm[] = ['monthly', 'yearly']

function TeamStage({
  term,
  onTermChange,
  saving,
  onCheckout,
  onContinueSolo,
  onBack
}: {
  term: BillingTerm
  onTermChange: (t: BillingTerm) => void
  saving: boolean
  onCheckout: () => void
  onContinueSolo: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={2}
      stage="team"
      title={
        <>
          fly your <em className="text-zinc-50">company&apos;s</em> colors.
        </>
      }
      subtitle="One account becomes the team. It carries the mark, and your pilots carry it onto the board — everyone keeps their own solo profile."
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* the pitch — three lines, gold checks */}
        <div
          className="card-enter glass-lite rounded-2xl p-6"
          style={{ ['--wd' as string]: '0ms' }}
        >
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
            <TeamPerkItem text="The square avatar — a company mark, not a face" />
            <TeamPerkItem text="Up to 10 affiliated pilots wearing your mark on the board" />
          </ul>
        </div>

        {/* the term — prices come from planTerms, never hardcoded here */}
        <div className="flex flex-col gap-3">
          {TEAM_TERM_ORDER.map((t, i) => {
            const meta = TEAM_TERMS[t]
            const selected = term === t
            return (
              <ChoiceCard
                key={t}
                selected={selected}
                onClick={() => onTermChange(t)}
                index={i + 1}
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
        by hand identity verification — the badge unlocks on approval,
        within 24 hours.
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
   STEP 2 — Privacy reassurance
   ============================================================ */

function PrivacyStage({
  onNext,
  onBack
}: {
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={2}
      stage="privacy"
      title={
        <>
          we count <em className="text-zinc-50">showing up</em>, not what you
          say.
        </>
      }
      subtitle="The extension only measures which AI tools you visit and for how long. It never reads what you type, what the model says back, or your chat history."
    >
      <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card-enter glass-lite rounded-2xl p-6" style={{ ['--wd' as string]: '0ms' }}>
          <div className="flex items-center gap-2.5">
            <IconActivity size={17} className="text-accent" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              WHAT WE COLLECT
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            <PrivacyItem text="Domains you visit (chatgpt.com, claude.ai, …)" />
            <PrivacyItem text="Active vs idle minutes per tab" />
            <PrivacyItem text="Number of visits per tool" />
            <PrivacyItem text="Sync timestamps for streak math" />
          </ul>
        </div>
        <div className="card-enter glass-lite rounded-2xl p-6" style={{ ['--wd' as string]: '70ms' }}>
          <div className="flex items-center gap-2.5">
            <IconShieldCheck size={17} className="text-zinc-300" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              WHAT WE NEVER TOUCH
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            <PrivacyItem cross text="Your prompts. Ever." />
            <PrivacyItem cross text="The model's responses" />
            <PrivacyItem cross text="Your chat history or files" />
            <PrivacyItem cross text="Keystrokes, clipboard, screens" />
          </ul>
        </div>
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-zinc-500">
        <span className="text-accent">*</span> Think Strava for the prompt
        grind — we log the session, never the conversation.
      </p>

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onNext}>Sounds fair</PrimaryButton>
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
   STEP 3 — Role
   ============================================================ */

function RoleStage({
  value,
  onChange,
  onNext,
  onBack
}: {
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={3}
      stage="role"
      title={
        <>
          what do you <em className="text-zinc-50">do</em>?
        </>
      }
      subtitle="Pick whatever fits best — we use it to tune leaderboards and recap copy. You can change it anytime from your profile."
    >
      <div className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {ROLES.map((r, i) => (
          <ChoiceCard
            key={r.id}
            selected={value === r.id}
            onClick={() => onChange(r.id)}
            index={i}
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
   STEP 4 — Goal
   ============================================================ */

function GoalStage({
  value,
  onChange,
  onNext,
  onBack
}: {
  value: string | null
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <StageShell
      step={4}
      stage="goal"
      title={
        <>
          what&apos;s the <em className="text-zinc-50">mission</em>?
        </>
      }
      subtitle="One main thing you'd want AI tools to help you crush over the next few months."
    >
      <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {GOALS.map((g, i) => (
          <ChoiceCard
            key={g.id}
            selected={value === g.id}
            onClick={() => onChange(g.id)}
            index={i}
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
   STEP 5 — Top tools (multi-select), finishes straight to dashboard
   ============================================================ */

function ToolsStage({
  value,
  onChange,
  onSubmit,
  onBack,
  saving
}: {
  value: string[]
  onChange: (v: string[]) => void
  onSubmit: () => void
  onBack: () => void
  saving: boolean
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id))
    else if (value.length < 4) onChange([...value, id])
  }

  return (
    <StageShell
      step={5}
      stage="tools"
      title={
        <>
          pick your <em className="text-zinc-50">daily drivers</em>.
        </>
      }
      subtitle={`Up to four. The extension detects everything else automatically — this just preloads your dashboard. ${value.length}/4 selected.`}
    >
      <div className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {TOOLS.map((t, i) => {
          const selected = value.includes(t.id)
          const atCap = !selected && value.length >= 4
          return (
            <ChoiceCard
              key={t.id}
              selected={selected}
              onClick={() => !atCap && toggle(t.id)}
              disabled={atCap}
              index={i}
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

      <StageActions>
        <GhostButton onClick={onBack}>Back</GhostButton>
        <PrimaryButton onClick={onSubmit} disabled={saving}>
          {saving ? 'Opening dashboard…' : 'Enter dashboard'}
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   STEP 6 — Install the extension (only when the store listing is live)
   ============================================================ */

function ExtensionStage({ onDone }: { onDone: () => void }) {
  const { detected } = useExtensionDetection(true)

  return (
    <StageShell
      step={SOLO_STEPS.length}
      stage="extension"
      title={
        <>
          one last thing — the <em className="text-zinc-50">tracker</em>{' '}
          itself.
        </>
      }
      subtitle="Install the Chrome extension once. It links itself the moment your dashboard loads — no setup, no keys, nothing to configure."
    >
      <div
        className="card-enter glass-lite mt-9 rounded-2xl p-6"
        style={{
          ['--wd' as string]: '0ms',
          borderColor: detected ? 'rgb(var(--accent-rgb) / 0.5)' : undefined
        }}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <CardIcon icon={IconPuzzle} selected={detected} />
            <div>
              <div className="text-sm font-semibold text-zinc-100">
                Cribble for Chrome
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                counts your minutes on AI tools — never reads a word
              </div>
            </div>
          </div>
          <a
            href={EXTENSION_INSTALL_URL ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-full border border-zinc-700 text-zinc-100 hover:border-zinc-500 hover:-translate-y-px transition-all duration-300"
          >
            Add to Chrome
            <IconArrowRight size={14} />
          </a>
        </div>

        <div className="mt-6 border-t border-zinc-800/80 pt-4">
          {detected ? (
            <div className="flex items-center gap-3">
              <span className="check-pop inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-black">
                <IconCheck size={11} />
              </span>
              <span className="font-mono text-[10px] tracking-[0.3em] text-accent">
                EXTENSION DETECTED
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-5 w-5 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
                WAITING FOR INSTALL…
              </span>
            </div>
          )}
        </div>
      </div>

      <StageActions>
        <GhostButton onClick={onDone} noIcon>
          Skip for now
        </GhostButton>
        <PrimaryButton onClick={onDone} emphasized={detected}>
          Enter dashboard
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   SHARED PIECES
   ============================================================ */

function StageShell({
  step,
  stage,
  title,
  subtitle,
  children
}: {
  /** Position in the active path (mode is 1 on both; the paths never
   *  renumber a shared stage, so each stage knows its own slot). */
  step: number
  stage: Exclude<Stage, 'intro'>
  title: React.ReactNode
  subtitle: string
  children: React.ReactNode
}) {
  const meta = STEP_META[stage]
  return (
    <section className="w-full max-w-3xl">
      <div className="font-mono text-[10px] tracking-[0.35em] text-zinc-500 uppercase">
        <span className="text-accent">{String(step).padStart(2, '0')}</span>
        <span className="mx-2 text-zinc-700">/</span>
        {meta.eyebrow}
      </div>
      <h1 className="mt-4 font-serif text-4xl md:text-5xl leading-[1.08] text-zinc-300">
        {title}
      </h1>
      <p className="mt-4 text-sm md:text-[15px] text-zinc-500 leading-relaxed max-w-xl">
        {subtitle}
      </p>
      {children}
    </section>
  )
}

function StageActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-end gap-3">
      {children}
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  emphasized
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  emphasized?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-2.5 text-[13px] font-semibold px-6 py-3 rounded-full transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:-translate-y-px enabled:active:translate-y-0"
      style={{
        background: 'var(--foreground)',
        color: 'var(--background)',
        boxShadow: emphasized
          ? '0 0 26px rgb(var(--accent-rgb) / 0.35)'
          : undefined
      }}
    >
      {children}
      <IconArrowRight
        size={15}
        className="transition-transform duration-300 group-enabled:group-hover:translate-x-0.5"
      />
    </button>
  )
}

function GhostButton({
  children,
  onClick,
  noIcon
}: {
  children: React.ReactNode
  onClick?: () => void
  noIcon?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 text-[13px] px-5 py-3 rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
    >
      {!noIcon && <IconArrowLeft size={15} />}
      {children}
    </button>
  )
}

function CardIcon({
  icon: Icon,
  selected
}: {
  icon: IconComponent
  selected: boolean
}) {
  return (
    <span
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors duration-300 ${
        selected
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
      }`}
    >
      <Icon size={19} />
    </span>
  )
}

function ChoiceCard({
  selected,
  disabled,
  onClick,
  index = 0,
  large,
  children
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  index?: number
  large?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`card-enter relative text-left rounded-2xl border backdrop-blur-sm transition-all duration-300 ${
        large ? 'p-6' : 'p-4'
      } ${
        disabled
          ? 'opacity-35 cursor-not-allowed border-zinc-800 bg-zinc-950/70'
          : selected
          ? 'border-accent/50 bg-accent/[0.05]'
          : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-600 hover:-translate-y-0.5'
      }`}
      style={{ ['--wd' as string]: `${index * 45}ms` }}
    >
      {selected && (
        <span className="check-pop absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-black">
          <IconCheck size={11} />
        </span>
      )}
      {children}
    </button>
  )
}
