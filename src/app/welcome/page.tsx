'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'

const HACKER_GREEN = '#02fe01'

type Stage = 'boot' | 'privacy' | 'role' | 'goal' | 'tools' | 'thanks'

const STEP_ORDER: Stage[] = ['privacy', 'role', 'goal', 'tools', 'thanks']

const ROLES: { id: string; label: string; glyph: string; hint: string }[] = [
  { id: 'student', label: 'STUDENT', glyph: '▲', hint: 'class, papers, projects' },
  { id: 'researcher', label: 'RESEARCHER', glyph: '✦', hint: 'theses, labs, science' },
  { id: 'developer', label: 'DEVELOPER', glyph: '◇', hint: 'shipping code daily' },
  { id: 'designer', label: 'DESIGNER', glyph: '◆', hint: 'pixels, vectors, taste' },
  { id: 'founder', label: 'FOUNDER', glyph: '⌬', hint: 'building a thing' },
  { id: 'product', label: 'PRODUCT', glyph: '⬢', hint: 'specs to shipping' },
  { id: 'writer', label: 'WRITER', glyph: '▰', hint: 'words for a living' },
  { id: 'other', label: 'OTHER', glyph: '◌', hint: 'something else cool' }
]

const GOALS: { id: string; label: string; hint: string }[] = [
  { id: 'learn', label: 'LEARN A SKILL', hint: 'study, practice, level up' },
  { id: 'build', label: 'BUILD A PRODUCT', hint: 'ship something real' },
  { id: 'research', label: 'DO RESEARCH', hint: 'academic or industry' },
  { id: 'work', label: 'WORK FASTER', hint: 'crush daily output' },
  { id: 'hobby', label: 'STAY CURIOUS', hint: 'no agenda, just vibes' },
  { id: 'other', label: 'SOMETHING ELSE', hint: 'tell us later' }
]

const TOOLS: { id: string; label: string }[] = [
  { id: 'chatgpt', label: 'CHATGPT' },
  { id: 'claude', label: 'CLAUDE' },
  { id: 'gemini', label: 'GEMINI' },
  { id: 'perplexity', label: 'PERPLEXITY' },
  { id: 'cursor', label: 'CURSOR' },
  { id: 'copilot', label: 'GH COPILOT' },
  { id: 'midjourney', label: 'MIDJOURNEY' },
  { id: 'other', label: 'OTHER' }
]

const WIZARD_STAGES: Stage[] = ['privacy', 'role', 'goal', 'tools']
const AMBIENCE_AUDIO_PATH = '/audio/ambience/deeper-into-it.mp3'
const INTRO_AUDIO_PATH = '/audio/intro/welcome-to-cribble.mp3'

export default function WelcomePage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('boot')
  const [role, setRole] = useState<string | null>(null)
  const [goal, setGoal] = useState<string | null>(null)
  const [topTools, setTopTools] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false)
  const [statusKnown, setStatusKnown] = useState(false)
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null)
  const introAudioRef = useRef<HTMLAudioElement | null>(null)
  const introPlayedRef = useRef(false)

  useEffect(() => {
    const ambience = new Audio(AMBIENCE_AUDIO_PATH)
    ambience.loop = true
    ambience.volume = 0.32
    ambience.preload = 'auto'
    ambienceAudioRef.current = ambience

    const intro = new Audio(INTRO_AUDIO_PATH)
    intro.volume = 0.85
    intro.preload = 'auto'
    introAudioRef.current = intro

    return () => {
      ambience.pause()
      ambience.currentTime = 0
      intro.pause()
      intro.currentTime = 0
      ambienceAudioRef.current = null
      introAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const ambience = ambienceAudioRef.current
    const intro = introAudioRef.current
    if (!ambience || !intro) return

    const playSafely = async (audio: HTMLAudioElement) => {
      try {
        await audio.play()
      } catch {
        // Browser autoplay policies may block until user gesture.
      }
    }

    if (WIZARD_STAGES.includes(stage)) {
      intro.pause()
      intro.currentTime = 0
      introPlayedRef.current = false
      void playSafely(ambience)
      return
    }

    ambience.pause()
    ambience.currentTime = 0

    if (stage === 'thanks') {
      if (introPlayedRef.current) return
      intro.currentTime = 0
      introPlayedRef.current = true
      void playSafely(intro)
      return
    }

    intro.pause()
    intro.currentTime = 0
    introPlayedRef.current = false
  }, [stage])

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/onboarding', { credentials: 'include' })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.onboarded) setAlreadyOnboarded(true)
        setStatusKnown(true)
      })
      .catch(() => {
        if (!cancelled) setStatusKnown(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // After the boot finishes, branch on whether the user is already onboarded.
  useEffect(() => {
    if (stage !== 'boot') return
    const minBoot = 2800
    const id = setTimeout(() => {
      if (!statusKnown) {
        // status hasn't returned yet — short retry tick
        return
      }
      if (alreadyOnboarded) {
        router.replace('/dashboard')
      } else {
        setStage('privacy')
      }
    }, minBoot)
    return () => clearTimeout(id)
  }, [stage, alreadyOnboarded, statusKnown, router])

  // Safety: if status arrives later than 2.8s, still advance.
  useEffect(() => {
    if (stage !== 'boot' || !statusKnown) return
    const t = setTimeout(() => {
      if (alreadyOnboarded) router.replace('/dashboard')
      else setStage('privacy')
    }, 200)
    return () => clearTimeout(t)
  }, [statusKnown, alreadyOnboarded, stage, router])

  const advance = useCallback(() => {
    setStage((cur) => {
      const idx = STEP_ORDER.indexOf(cur)
      const next = STEP_ORDER[idx + 1]
      return next || cur
    })
  }, [])

  const submit = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await fetch('/api/user/onboarding', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, goal, topTools, newsletter: false })
      })
    } catch {
      // intentionally swallow — we'd rather show thanks than block the user
    }
    setStage('thanks')
    setSaving(false)
  }, [role, goal, topTools, saving])

  useEffect(() => {
    if (stage !== 'thanks') return
    const id = setTimeout(() => router.replace('/dashboard'), 2200)
    return () => clearTimeout(id)
  }, [stage, router])

  const skip = useCallback(() => {
    router.replace('/dashboard')
  }, [router])

  const stepNumber = useMemo(() => {
    if (stage === 'boot' || stage === 'thanks') return null
    return STEP_ORDER.indexOf(stage) + 1
  }, [stage])

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono relative overflow-hidden selection:bg-[#02fe01]/20">
      <SpaceBackdrop />

      {/* horizon line */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 h-px opacity-30 z-0"
        style={{
          background: `linear-gradient(90deg, transparent, ${HACKER_GREEN}88, transparent)`
        }}
      />

      <div className="relative z-10 min-h-screen flex flex-col">
        {stage !== 'boot' && stage !== 'thanks' && (
          <TopBar
            stepNumber={stepNumber}
            totalSteps={STEP_ORDER.length - 1}
            onSkip={skip}
          />
        )}

        <main className="flex-1 flex items-center justify-center px-6 py-10">
          {stage === 'boot' && <BootStage />}
          {stage === 'privacy' && <PrivacyStage onNext={advance} />}
          {stage === 'role' && (
            <RoleStage value={role} onChange={setRole} onNext={advance} />
          )}
          {stage === 'goal' && (
            <GoalStage value={goal} onChange={setGoal} onNext={advance} />
          )}
          {stage === 'tools' && (
            <ToolsStage
              value={topTools}
              onChange={setTopTools}
              onSubmit={submit}
              saving={saving}
            />
          )}
          {stage === 'thanks' && <ThanksStage role={role} />}
        </main>
      </div>
    </div>
  )
}

/* ============================================================
   TOP BAR — progress + skip
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
  const pct = stepNumber ? Math.round((stepNumber / totalSteps) * 100) : 0
  return (
    <header className="relative z-10 px-6 pt-6">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <div className="text-sm tracking-[0.4em] text-zinc-100 font-semibold">
          CRIBBLE<span style={{ color: HACKER_GREEN }}>.</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-[10px] tracking-[0.3em] text-zinc-500 tabular-nums">
            STEP {stepNumber}/{totalSteps}
          </div>
          <button
            onClick={onSkip}
            className="text-[10px] tracking-[0.3em] px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            SKIP →
          </button>
        </div>
      </div>
      <div className="mt-4 max-w-3xl mx-auto">
        <div className="h-px w-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: HACKER_GREEN,
              boxShadow: `0 0 8px ${HACKER_GREEN}99`
            }}
          />
        </div>
      </div>
    </header>
  )
}

/* ============================================================
   STAGE 0 — Boot animation (finite, advances on its own timer)
   ============================================================ */

function BootStage() {
  return (
    <div className="relative w-full max-w-md px-2">
      <div className="text-center">
        <div className="text-[10px] tracking-[0.5em] text-zinc-600">
          [ SYSTEM ]
        </div>
        <div
          className="mt-2 text-2xl md:text-3xl tracking-[0.35em] font-semibold boot-glitch"
          style={{
            color: HACKER_GREEN,
            textShadow: `0 0 10px ${HACKER_GREEN}66, 0 0 28px ${HACKER_GREEN}33`
          }}
        >
          CRIBBLE<span className="text-zinc-500">{'//'}</span>OS
        </div>
        <div className="mt-1 text-[10px] tracking-[0.4em] text-zinc-600">
          v2.1.0 · LOGIN ACCEPTED
        </div>
      </div>

      <div className="mt-10 space-y-1.5 text-xs">
        <BootLine delay={0} text="LINK_ESTABLISHED" />
        <BootLine delay={0.35} text="GITHUB_HANDSHAKE OK" />
        <BootLine delay={0.7} text="SESSION_FORGED" />
        <BootLine delay={1.1} text="LOADING USER_PROFILE_" cursor />
      </div>

      <div className="mt-8">
        <div
          className="relative h-1.5 w-full rounded-sm overflow-hidden border"
          style={{
            borderColor: `${HACKER_GREEN}40`,
            background: 'rgba(2,254,1,0.05)'
          }}
        >
          <div
            className="boot-bar absolute inset-y-0 left-0"
            style={{
              background: HACKER_GREEN,
              boxShadow: `0 0 12px ${HACKER_GREEN}99, 0 0 24px ${HACKER_GREEN}55`
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[9px] tracking-[0.3em] text-zinc-600">
          <span>{'>'} BOOTING</span>
          <span className="boot-pct tabular-nums" />
        </div>
      </div>

      <div className="mt-12 text-center text-[10px] tracking-[0.4em] text-zinc-700 boot-pulse">
        ⌬ WELCOME, PILOT ⌬
      </div>

      <style jsx global>{`
        @keyframes boot-bar {
          0% {
            width: 0%;
          }
          100% {
            width: 100%;
          }
        }
        .boot-bar {
          width: 0%;
          animation: boot-bar 2.6s ease-out forwards;
        }

        @keyframes boot-pct {
          0%,
          15% { content: '08%'; }
          16%,
          30% { content: '22%'; }
          31%,
          45% { content: '41%'; }
          46%,
          60% { content: '58%'; }
          61%,
          75% { content: '74%'; }
          76%,
          90% { content: '89%'; }
          91%,
          100% { content: '100%'; }
        }
        .boot-pct::before {
          content: '00%';
          animation: boot-pct 2.6s ease-out forwards;
        }

        @keyframes boot-line-in {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .boot-line {
          opacity: 0;
          animation: boot-line-in 0.45s ease-out forwards;
        }

        @keyframes boot-cursor {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .boot-cursor {
          display: inline-block;
          width: 7px;
          height: 11px;
          margin-left: 2px;
          vertical-align: -1px;
          background: ${HACKER_GREEN};
          box-shadow: 0 0 6px ${HACKER_GREEN}aa;
          animation: boot-cursor 0.9s steps(2) infinite;
        }

        @keyframes boot-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        .boot-pulse {
          animation: boot-pulse 1.8s ease-in-out infinite;
        }

        @keyframes boot-glitch {
          0%, 96%, 100% { transform: translate(0, 0); }
          97% { transform: translate(-1px, 0); }
          98% { transform: translate(1px, 0); }
        }
        .boot-glitch {
          animation: boot-glitch 4s steps(1) infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .boot-bar { width: 95%; animation: none; }
          .boot-line { opacity: 1; animation: none; }
          .boot-cursor, .boot-pulse, .boot-glitch, .boot-pct::before {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

function BootLine({
  delay,
  text,
  cursor
}: {
  delay: number
  text: string
  cursor?: boolean
}) {
  return (
    <div
      className="boot-line flex items-center gap-2"
      style={{ animationDelay: `${delay}s` }}
    >
      <span style={{ color: HACKER_GREEN }}>{'>'}</span>
      <span className="text-zinc-300">{text}</span>
      {cursor && <span className="boot-cursor" />}
    </div>
  )
}

/* ============================================================
   STAGE 1 — Privacy reassurance
   ============================================================ */

function PrivacyStage({ onNext }: { onNext: () => void }) {
  return (
    <StageShell
      eyebrow="ABOUT_TRACKING.MD"
      title="we measure usage, not your prompts."
      subtitle="The extension only counts which AI tools you visit and for how long. It never reads what you type, what the model says back, or your chat history. Promise."
    >
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          className="rounded-xl border bg-zinc-950/80 backdrop-blur-sm p-5"
          style={{ borderColor: `${HACKER_GREEN}40` }}
        >
          <div
            className="text-[10px] tracking-[0.4em]"
            style={{ color: `${HACKER_GREEN}cc` }}
          >
            ✓ WHAT WE COLLECT
          </div>
          <ul className="mt-4 space-y-2.5 text-xs text-zinc-300">
            <PrivacyItem text="Domains you visit (chatgpt.com, claude.ai, …)." />
            <PrivacyItem text="Active vs idle minutes per tab." />
            <PrivacyItem text="Number of visits per tool." />
            <PrivacyItem text="Sync timestamps for streak math." />
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm p-5">
          <div className="text-[10px] tracking-[0.4em] text-rose-300/80">
            ✗ WHAT WE DON&apos;T TOUCH
          </div>
          <ul className="mt-4 space-y-2.5 text-xs text-zinc-300">
            <PrivacyItem cross text="Your prompts. Ever." />
            <PrivacyItem cross text="The model's responses." />
            <PrivacyItem cross text="Your chat history or files." />
            <PrivacyItem cross text="Keystrokes, clipboard, screens." />
          </ul>
        </div>
      </div>

      <p className="mt-6 text-[11px] tracking-[0.2em] text-zinc-500">
        <span style={{ color: `${HACKER_GREEN}cc` }}>{'// '}</span>
        TL;DR — we count when you show up, not what you say. Like a Strava for
        the prompt grind.
      </p>

      <StageActions>
        <PrimaryButton onClick={onNext}>I UNDERSTAND — CONTINUE →</PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

function PrivacyItem({ text, cross }: { text: string; cross?: boolean }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-[3px] inline-block text-[11px]"
        style={{ color: cross ? '#fb7185' : HACKER_GREEN }}
      >
        {cross ? '✗' : '✓'}
      </span>
      <span>{text}</span>
    </li>
  )
}

/* ============================================================
   STAGE 2 — Role
   ============================================================ */

function RoleStage({
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
      eyebrow="WHO_ARE_YOU.MD"
      title="what brings you to cribble?"
      subtitle="Pick the role that fits you best. We use this to tune leaderboards and weekly recap copy — it's not a permanent label."
    >
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {ROLES.map((r) => (
          <ChoiceCard
            key={r.id}
            selected={value === r.id}
            onClick={() => onChange(r.id)}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="text-base"
                style={{
                  color: value === r.id ? HACKER_GREEN : '#71717a'
                }}
              >
                {r.glyph}
              </span>
            </div>
            <div className="mt-3 text-sm font-semibold tracking-[0.1em] text-zinc-100">
              {r.label}
            </div>
            <div className="mt-1 text-[10px] tracking-wide text-zinc-500">
              {r.hint}
            </div>
          </ChoiceCard>
        ))}
      </div>

      <StageActions>
        <PrimaryButton onClick={onNext} disabled={!value}>
          NEXT →
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   STAGE 3 — Goal
   ============================================================ */

function GoalStage({
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
      eyebrow="MISSION.MD"
      title="what's the mission?"
      subtitle="One main goal you'd want AI tools to help you crush over the next few months."
    >
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {GOALS.map((g) => (
          <ChoiceCard
            key={g.id}
            selected={value === g.id}
            onClick={() => onChange(g.id)}
            wide
          >
            <div className="text-sm font-semibold tracking-[0.1em] text-zinc-100">
              {g.label}
            </div>
            <div className="mt-1 text-[10px] tracking-wide text-zinc-500">
              {g.hint}
            </div>
          </ChoiceCard>
        ))}
      </div>

      <StageActions>
        <PrimaryButton onClick={onNext} disabled={!value}>
          NEXT →
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   STAGE 4 — Top tools (multi-select)
   ============================================================ */

function ToolsStage({
  value,
  onChange,
  onSubmit,
  saving
}: {
  value: string[]
  onChange: (v: string[]) => void
  onSubmit: () => void
  saving: boolean
}) {
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id))
    else if (value.length < 4) onChange([...value, id])
  }

  return (
    <StageShell
      eyebrow="LOADOUT.MD"
      title="which tools do you live in?"
      subtitle={`Pick up to 4. The extension will detect more automatically — this just helps us preload your dashboard. (${value.length}/4 selected)`}
    >
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {TOOLS.map((t) => {
          const selected = value.includes(t.id)
          const atCap = !selected && value.length >= 4
          return (
            <ChoiceCard
              key={t.id}
              selected={selected}
              onClick={() => !atCap && toggle(t.id)}
              disabled={atCap}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold tracking-[0.1em] text-zinc-100">
                  {t.label}
                </div>
                <span
                  className="text-[11px]"
                  style={{
                    color: selected ? HACKER_GREEN : 'transparent'
                  }}
                >
                  ✓
                </span>
              </div>
            </ChoiceCard>
          )
        })}
      </div>

      <StageActions>
        <PrimaryButton onClick={onSubmit} disabled={saving}>
          {saving ? 'SAVING…' : 'FINISH BOOT →'}
        </PrimaryButton>
      </StageActions>
    </StageShell>
  )
}

/* ============================================================
   STAGE 5 — Thanks
   ============================================================ */

function ThanksStage({ role }: { role: string | null }) {
  const roleLabel =
    ROLES.find((r) => r.id === role)?.label.toLowerCase() || 'pilot'
  return (
    <div className="relative w-full max-w-md px-2 text-center">
      <div className="text-[10px] tracking-[0.5em] text-zinc-600">
        [ HANDSHAKE COMPLETE ]
      </div>
      <div
        className="mt-3 text-3xl md:text-4xl tracking-[0.25em] font-semibold"
        style={{
          color: HACKER_GREEN,
          textShadow: `0 0 10px ${HACKER_GREEN}66, 0 0 28px ${HACKER_GREEN}33`
        }}
      >
        WELCOME, {roleLabel.toUpperCase()}
      </div>
      <div className="mt-3 text-[11px] tracking-[0.3em] text-zinc-500">
        cribble//os is live. opening dashboard…
      </div>
      <div className="mt-8 inline-block">
        <div className="h-px w-40 overflow-hidden bg-zinc-900 mx-auto">
          <div
            className="h-full"
            style={{
              background: HACKER_GREEN,
              boxShadow: `0 0 8px ${HACKER_GREEN}99`,
              animation: 'thanks-bar 2s ease-out forwards'
            }}
          />
        </div>
      </div>
      <style jsx global>{`
        @keyframes thanks-bar {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
    </div>
  )
}

/* ============================================================
   SHARED PIECES
   ============================================================ */

function StageShell({
  eyebrow,
  title,
  subtitle,
  children
}: {
  eyebrow: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="w-full max-w-3xl">
      <div
        className="text-[10px] tracking-[0.4em]"
        style={{ color: `${HACKER_GREEN}cc` }}
      >
        {'//'} {eyebrow}
      </div>
      <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-50">
        {title}
      </h1>
      <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-2xl">
        {subtitle}
      </p>
      {children}
    </section>
  )
}

function StageActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-end gap-2">{children}</div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] tracking-[0.3em] px-5 py-2.5 rounded-md border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={
        disabled
          ? {
              borderColor: '#27272a',
              color: '#71717a',
              background: 'transparent'
            }
          : {
              borderColor: `${HACKER_GREEN}80`,
              color: HACKER_GREEN,
              background: `${HACKER_GREEN}12`,
              boxShadow: `0 0 18px ${HACKER_GREEN}30`
            }
      }
    >
      {children}
    </button>
  )
}

function ChoiceCard({
  selected,
  disabled,
  onClick,
  wide,
  children
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl border bg-zinc-950/80 backdrop-blur-sm transition-all ${
        wide ? 'p-5' : 'p-4'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        borderColor: selected ? `${HACKER_GREEN}80` : '#27272a',
        background: selected ? `${HACKER_GREEN}0d` : undefined,
        boxShadow: selected ? `0 0 22px ${HACKER_GREEN}26 inset` : undefined
      }}
      onMouseEnter={(e) => {
        if (!selected && !disabled)
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#52525b'
      }}
      onMouseLeave={(e) => {
        if (!selected && !disabled)
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#27272a'
      }}
    >
      {children}
    </button>
  )
}
