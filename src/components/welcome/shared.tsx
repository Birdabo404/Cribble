'use client'

import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  type IconProps
} from '@/components/welcome/icons'

/** Every stop the wizard can be on. The active path (a subset, ordered)
 *  is a function of the chosen mode + count mode — see the welcome page. */
export type Stage =
  | 'intro'
  | 'mode'
  | 'team'
  | 'count'
  | 'privacy'
  | 'role'
  | 'goal'
  | 'tools'
  | 'extension'
  | 'agent'

export type IconComponent = (p: IconProps) => JSX.Element

export const STEP_META: Record<Exclude<Stage, 'intro'>, { eyebrow: string }> =
  {
    mode: { eyebrow: 'Account' },
    team: { eyebrow: 'Your team' },
    count: { eyebrow: 'Signal' },
    privacy: { eyebrow: 'Privacy' },
    role: { eyebrow: 'About you' },
    goal: { eyebrow: 'Goal' },
    tools: { eyebrow: 'Loadout' },
    extension: { eyebrow: 'Extension' },
    agent: { eyebrow: 'Agent link' }
  }

export function StageShell({
  step,
  stage,
  title,
  subtitle,
  children
}: {
  /** Position in the active path, computed by the page from the live
   *  step list — the count and agent stages shift the numbering. */
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
      <p className="mt-4 text-[15px] leading-[1.45] text-zinc-500 max-w-xl">
        {subtitle}
      </p>
      {children}
    </section>
  )
}

export function StageActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-end gap-3">
      {children}
    </div>
  )
}

export function PrimaryButton({
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
      className="press-scale cta-brighten inline-flex items-center gap-2.5 text-[13px] font-semibold px-6 py-3 rounded-full transition-[border-color,background-color,box-shadow,color] duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        background: 'var(--foreground)',
        color: 'var(--background)',
        // Layered tight + wide bloom reads as light on the button, not a
        // single fat halo around it.
        boxShadow: emphasized
          ? '0 0 10px rgb(var(--accent-rgb) / 0.25), 0 0 34px rgb(var(--accent-rgb) / 0.12)'
          : undefined
      }}
    >
      {children}
      <IconArrowRight size={15} />
    </button>
  )
}

export function GhostButton({
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
      className="press-scale inline-flex items-center gap-2 text-[13px] px-5 py-3 rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
    >
      {!noIcon && <IconArrowLeft size={15} />}
      {children}
    </button>
  )
}

export function CardIcon({
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
          ? 'border-accent/25 bg-accent/[0.06] text-accent'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
      }`}
    >
      <Icon size={19} />
    </span>
  )
}

/** Selectable card. The `card-enter` class is a GSAP hook: the page's
 *  stage-entrance timeline staggers everything carrying it. */
export function ChoiceCard({
  selected,
  disabled,
  onClick,
  large,
  className = '',
  children
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  large?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`card-enter press-scale relative text-left rounded-2xl border bg-zinc-950/70 transition-[border-color,background-color,box-shadow,color] duration-300 ${
        large ? 'p-6' : 'p-4'
      } ${
        disabled
          ? 'opacity-35 cursor-not-allowed border-zinc-800'
          : selected
          ? 'phos-selected border-accent/25'
          : 'border-zinc-800 hover:border-zinc-600'
      } ${className}`}
    >
      {selected && (
        <span className="check-pop phos-check absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 bg-zinc-950 text-accent">
          <IconCheck size={11} />
        </span>
      )}
      {children}
    </button>
  )
}

/** The hue a setup stage's phase cards ride: ember on token surfaces
 *  (the agent link), phosphor accent on browser ones (the extension). */
export type PhaseTone = 'ember' | 'accent'

const PHASE_TONE: Record<
  PhaseTone,
  { activeBorder: string; doneChip: string }
> = {
  ember: {
    activeBorder: 'rgb(var(--ember-rgb) / 0.4)',
    doneChip: 'border-transparent bg-ember text-black'
  },
  accent: {
    activeBorder: 'rgb(var(--accent-rgb) / 0.4)',
    // The CRT status light, not a filled sticker — the same idiom as the
    // selected-card check.
    doneChip: 'phos-check border-accent/40 bg-zinc-950 text-accent'
  }
}

/** One phase of a setup sequence: numbered chip, mono label, title, and
 *  a body. `data-phase={id}` lets a stage scroll a card into view. Pass
 *  no children to render a collapsed header alone. */
export function PhaseCard({
  id,
  index,
  label,
  title,
  done,
  active,
  tone = 'accent',
  status,
  children
}: {
  id: string
  index: string
  label: string
  title: React.ReactNode
  done: boolean
  active: boolean
  tone?: PhaseTone
  /** Right-aligned mono status word for the header row (LINKED,
   *  EXTENSION DETECTED…) — the ladder a user reads at a glance. */
  status?: React.ReactNode
  children?: React.ReactNode
}) {
  const hue = PHASE_TONE[tone]
  return (
    <div
      data-phase={id}
      className="card-enter glass-lite rounded-2xl p-5 transition-colors duration-300"
      style={{
        borderColor: active ? hue.activeBorder : undefined
      }}
    >
      {/* Wraps so a long status (EXTENSION DETECTED) drops to its own
          right-aligned line on narrow screens instead of crushing the
          title into one word per line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] transition-colors duration-300 ${
            done
              ? hue.doneChip
              : active
              ? 'border-zinc-600 text-zinc-200'
              : 'border-zinc-800 text-zinc-600'
          }`}
        >
          {done ? <IconCheck size={10} /> : index}
        </span>
        <span className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          {label}
        </span>
        <span className="text-sm font-semibold text-zinc-100">{title}</span>
        {status !== undefined && (
          <span className="ml-auto shrink-0 pl-3 text-right">{status}</span>
        )}
      </div>
      {children ? <div className="mt-4 pl-8">{children}</div> : null}
    </div>
  )
}

/** The one user-claimed step in a setup sequence, as a mono pill. */
export function MarkDoneButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-scale mt-3 inline-flex items-center gap-2 rounded-full border border-zinc-800 px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
    >
      {children}
    </button>
  )
}
