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
