'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { CountMode } from '@/lib/countMode'
import { IconFlame } from '@/components/welcome/icons'
import {
  ChoiceCard,
  GhostButton,
  PrimaryButton,
  StageActions,
  StageShell
} from '@/components/welcome/shared'
import { welcomeMotionReduced } from '@/components/welcome/welcomeMotion'

const COUNT_CARDS: {
  id: CountMode
  label: string
  hint: string
  tag: string
}[] = [
  {
    id: 'browser',
    label: 'Browser time',
    hint: 'The extension counts active minutes in ChatGPT, Claude, and the rest of your tabs.',
    tag: 'EXTENSION · LIVE PULSE'
  },
  {
    id: 'tokens',
    label: 'Coding-agent tokens',
    hint: 'The CLI counts what Claude Code, Codex, Cursor and whatever else you run burn through.',
    tag: 'CLI · TOKEN BURN'
  },
  {
    id: 'both',
    label: 'Both signals',
    hint: 'Browser minutes and token burn, wired into one profile.',
    tag: 'EXTENSION + CLI · DUAL FEED'
  }
]

/** Each card's animated identity: an ice pulse for the browser signal, an
 *  ember flame for token burn, both at once for the dual feed. The loops
 *  are the stage's one signal moment — selection just gets a pop. */
function SignalChamber({ mode }: { mode: CountMode }) {
  switch (mode) {
    case 'browser':
      return (
        <span className="count-chamber inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60">
          <PulseDot />
        </span>
      )
    case 'tokens':
      return (
        <span
          className="count-chamber inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-zinc-900/60 text-ember"
          style={{ borderColor: 'rgb(var(--ember-rgb) / 0.35)' }}
        >
          <span className="count-flame inline-flex">
            <IconFlame size={19} />
          </span>
        </span>
      )
    case 'both':
      return (
        <span className="count-chamber inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-xl border border-accent/35 bg-zinc-900/60">
          <PulseDot />
          <span className="count-flame inline-flex text-ember">
            <IconFlame size={15} />
          </span>
        </span>
      )
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

function PulseDot() {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center">
      <span className="count-ping absolute inset-0 rounded-full bg-ice/40" />
      <span className="h-1.5 w-1.5 rounded-full bg-ice" />
    </span>
  )
}

export function CountStage({
  step,
  value,
  onChange,
  onNext,
  onBack
}: {
  step: number
  value: CountMode | null
  onChange: (v: CountMode) => void
  onNext: () => void
  onBack: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Idle identity loops. Never started under reduced motion — the static
  // dot/flame reads fine on its own.
  const { contextSafe } = useGSAP(
    () => {
      if (welcomeMotionReduced()) return
      gsap.fromTo(
        '.count-ping',
        { scale: 0.5, autoAlpha: 0.8 },
        {
          scale: 2.2,
          autoAlpha: 0,
          duration: 1.6,
          repeat: -1,
          ease: 'power1.out'
        }
      )
      gsap.to('.count-flame', {
        scaleY: 0.86,
        scaleX: 1.06,
        autoAlpha: 0.7,
        transformOrigin: '50% 100%',
        duration: 0.34,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut'
      })
    },
    { scope: rootRef }
  )

  // Fired from click handlers after setup, so it must be contextSafe.
  const pick = contextSafe((next: CountMode) => {
    onChange(next)
    if (welcomeMotionReduced()) return
    gsap.fromTo(
      `.count-card-${next} .count-chamber`,
      { scale: 0.85 },
      { scale: 1, duration: 0.5, ease: 'back.out(2.4)', overwrite: 'auto' }
    )
  })

  // The honest CTA: picking tokens (alone or with the browser) means a
  // CLI setup stage is still ahead, so say so before the click.
  const cliAhead = value === 'tokens' || value === 'both'

  return (
    <StageShell
      step={step}
      stage="count"
      title="What should Cribble count?"
      subtitle="Pick the signal to wire in. You can add the other one later in Settings."
    >
      <div ref={rootRef}>
        <div className="mt-9 grid grid-cols-1 md:grid-cols-3 gap-3">
          {COUNT_CARDS.map((card) => (
            <ChoiceCard
              key={card.id}
              className={`count-card-${card.id}`}
              selected={value === card.id}
              onClick={() => pick(card.id)}
              large
            >
              <SignalChamber mode={card.id} />
              <div className="mt-4 text-base font-semibold text-zinc-100">
                {card.label}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
                {card.hint}
              </p>
              <div className="mt-4 font-mono text-[9px] tracking-[0.25em] text-zinc-600">
                {card.tag}
              </div>
            </ChoiceCard>
          ))}
        </div>

        <StageActions>
          <GhostButton onClick={onBack}>Back</GhostButton>
          <PrimaryButton onClick={onNext} disabled={!value}>
            {cliAhead ? 'Continue to CLI setup' : 'Continue'}
          </PrimaryButton>
        </StageActions>
      </div>
    </StageShell>
  )
}
