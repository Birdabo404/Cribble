'use client'

// Appearance settings — device-local preferences only, nothing persists
// server-side: theme via next-themes (class on <html>), nav position via
// NavPrefs (localStorage + data-nav-pos), and reduce motion (cribble.motion
// in localStorage, seeded pre-paint onto <html data-motion> by the nav
// boot script so the globals.css kill-switch applies before hydration).

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTheme } from 'next-themes'
import { useBackgroundMusic } from '@/components/music/BackgroundMusicProvider'
import { MOTION_KEY } from '@/components/nav/navBoot'
import { useNavPrefs, type NavPosition } from '@/components/nav/NavPrefsContext'
import {
  SegmentedControl,
  SettingsButton,
  SettingsRow,
  SettingsSection,
  Skeleton,
  Switch,
  type SegmentedOption
} from '@/components/settings'

/* ---------- theme preview cards ---------- */

type ThemeChoice = 'dark' | 'light' | 'system'

const THEME_CARDS: readonly { value: ThemeChoice; name: string; description: string }[] = [
  { value: 'dark', name: 'Dark', description: 'Deep neutral panels. The default.' },
  { value: 'light', name: 'Light', description: 'True white, maximum contrast.' },
  { value: 'system', name: 'System', description: 'Follows your device setting.' }
]

// The mockups depict a theme, so their colors are fixed literals — they
// deliberately never follow the page theme.
interface MockupPalette {
  canvas: string
  panel: string
  border: string
}

const DARK_MOCKUP: MockupPalette = {
  canvas: '#0A0A0B',
  panel: '#131316',
  border: 'rgba(255, 255, 255, 0.1)'
}

const LIGHT_MOCKUP: MockupPalette = {
  canvas: '#FFFFFF',
  panel: '#F4F4F5',
  border: '#E4E4E7'
}

/** Stylized mini app window — tiny sidebar with nav bars, content column
 *  with a heading bar and a panel. Fills its positioned parent so the
 *  System card can render two clipped copies in perfect register. */
function MiniWindow({ palette }: { palette: MockupPalette }) {
  return (
    <div aria-hidden className="absolute inset-0 flex" style={{ backgroundColor: palette.canvas }}>
      <div
        className="flex w-[28%] shrink-0 flex-col gap-[5px] border-r p-1.5"
        style={{ backgroundColor: palette.panel, borderColor: palette.border }}
      >
        <span className="h-1 w-full rounded-full" style={{ backgroundColor: palette.border }} />
        <span className="h-1 w-3/4 rounded-full" style={{ backgroundColor: palette.border }} />
        <span className="h-1 w-full rounded-full" style={{ backgroundColor: palette.border }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px] p-2">
        <span className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: palette.border }} />
        <span
          className="min-h-0 flex-1 rounded-[3px] border"
          style={{ backgroundColor: palette.panel, borderColor: palette.border }}
        />
        <span className="h-1 w-2/3 rounded-full" style={{ backgroundColor: palette.border }} />
      </div>
    </div>
  )
}

function ThemeMockup({ value }: { value: ThemeChoice }) {
  const frameCls = 'relative h-20 overflow-hidden rounded-md border border-[color:var(--st-border)]'
  switch (value) {
    case 'dark':
      return (
        <div className={frameCls}>
          <MiniWindow palette={DARK_MOCKUP} />
        </div>
      )
    case 'light':
      return (
        <div className={frameCls}>
          <MiniWindow palette={LIGHT_MOCKUP} />
        </div>
      )
    case 'system':
      // Diagonal split: dark above the anti-diagonal, light below it.
      return (
        <div className={frameCls}>
          <div className="absolute inset-0" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}>
            <MiniWindow palette={DARK_MOCKUP} />
          </div>
          <div
            className="absolute inset-0"
            style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
          >
            <MiniWindow palette={LIGHT_MOCKUP} />
          </div>
        </div>
      )
    default: {
      const exhaustive: never = value
      return exhaustive
    }
  }
}

/** Radiogroup of preview cards with SegmentedControl's roving-tabindex
 *  keyboard model: Tab lands on the selection, arrows move + select. */
function ThemeCards({
  value,
  onChange
}: {
  value: ThemeChoice | null
  onChange: (value: ThemeChoice) => void
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = THEME_CARDS.findIndex((card) => card.value === value)
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex

  const selectAt = (index: number) => {
    const card = THEME_CARDS[index]
    if (!card) return
    onChange(card.value)
    buttonRefs.current[index]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % THEME_CARDS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + THEME_CARDS.length) % THEME_CARDS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = THEME_CARDS.length - 1
    }
    if (next !== null) {
      event.preventDefault()
      selectAt(next)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {THEME_CARDS.map((card, i) => {
        const selected = i === selectedIndex
        return (
          <button
            key={card.value}
            ref={(el) => {
              buttonRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabbableIndex ? 0 : -1}
            onClick={() => onChange(card.value)}
            onKeyDown={(event) => handleKeyDown(event, i)}
            className={`rounded-lg border p-3 text-left transition-colors duration-150 ${
              selected
                ? 'border-[color:var(--st-accent)]'
                : 'border-[color:var(--st-border)] hover:border-[color:var(--st-border-strong)]'
            }`}
          >
            <ThemeMockup value={card.value} />
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium leading-5 text-[color:var(--st-text)]">
                {card.name}
              </span>
              {selected && (
                <span
                  aria-hidden
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--st-accent)]"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5 text-[color:var(--st-accent-contrast)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.25 5 8.75l4.5-5.5" />
                  </svg>
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] leading-4 text-[color:var(--st-text-muted)]">
              {card.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- navigation position ---------- */

const ICON_LEFT_RAIL = (
  <svg
    viewBox="0 0 14 14"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    aria-hidden
  >
    <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
    <path d="M5.25 2.5v9" />
  </svg>
)

const ICON_TOP_BAR = (
  <svg
    viewBox="0 0 14 14"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    aria-hidden
  >
    <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
    <path d="M1.5 5.75h11" />
  </svg>
)

const NAV_OPTIONS: readonly SegmentedOption<NavPosition>[] = [
  { value: 'left', label: 'Left rail', icon: ICON_LEFT_RAIL },
  { value: 'top', label: 'Top bar', icon: ICON_TOP_BAR }
]

/* ---------- page ---------- */

export default function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme()
  const navPrefs = useNavPrefs()
  const music = useBackgroundMusic()

  // Theme, nav position and the motion flag all resolve client-side
  // (next-themes / localStorage), so controls render in a neutral state
  // until mounted — same pattern as AppNav — to keep hydration clean.
  const [mounted, setMounted] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      setReduceMotion(window.localStorage.getItem(MOTION_KEY) === 'reduced')
    } catch {}
  }, [])

  const themeChoice: ThemeChoice | null =
    mounted && (theme === 'dark' || theme === 'light' || theme === 'system') ? theme : null

  const handleReduceMotion = (reduced: boolean) => {
    setReduceMotion(reduced)
    const root = document.documentElement
    if (reduced) {
      root.dataset.motion = 'reduced'
    } else {
      delete root.dataset.motion
    }
    try {
      window.localStorage.setItem(MOTION_KEY, reduced ? 'reduced' : 'auto')
    } catch {}
  }

  return (
    <div className="space-y-8">
      <SettingsSection title="Theme" description="How Cribble looks on this device.">
        <div className="px-4 py-4 sm:px-5">
          <ThemeCards value={themeChoice} onChange={setTheme} />
        </div>
      </SettingsSection>

      {navPrefs && (
        <SettingsSection title="Navigation">
          <SettingsRow
            label="Navigation bar"
            description="Where the app navigation lives on desktop."
            stack
          >
            {mounted ? (
              <SegmentedControl
                options={NAV_OPTIONS}
                value={navPrefs.position}
                onChange={navPrefs.setPosition}
                aria-label="Navigation bar position"
              />
            ) : (
              <Skeleton className="h-[50px] w-[172px] rounded-lg md:h-9" />
            )}
          </SettingsRow>
        </SettingsSection>
      )}

      <SettingsSection title="Motion">
        <SettingsRow
          label="Reduce motion"
          description="Minimize animations and transitions across Cribble."
        >
          <Switch checked={reduceMotion} onChange={handleReduceMotion} aria-label="Reduce motion" />
        </SettingsRow>
      </SettingsSection>

      {music && (
        <SettingsSection title="Sound">
          <SettingsRow
            label="Now playing"
            description="Background music on Dashboard, Bag, Shop, and Profile."
            stack
          >
            {mounted ? (
              /* Stacked full-width below sm: the title truncates and Skip
                 keeps its full tap target instead of getting crushed by a
                 long track name. Inline again from sm up, as before. */
              <span className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      music.playing
                        ? 'bg-[color:var(--st-accent)]'
                        : 'bg-[color:var(--st-text-faint)]'
                    }`}
                  />
                  <span className="min-w-0 truncate text-[13px] leading-5 text-[color:var(--st-text-muted)]">
                    {/* Settings is never a play route, so name the track even
                        while paused — a bare “Paused” would hide the title. */}
                    {music.playing ? music.currentTitle : `Paused — ${music.currentTitle}`}
                  </span>
                </span>
                <SettingsButton variant="ghost" onClick={music.skipNext}>
                  Skip
                </SettingsButton>
              </span>
            ) : (
              <Skeleton className="h-5 w-44" />
            )}
          </SettingsRow>
          <SettingsRow label="Mute" description="Silence background music entirely.">
            {mounted ? (
              <Switch
                checked={music.muted}
                onChange={music.setMuted}
                aria-label="Mute background music"
              />
            ) : (
              <Skeleton className="h-7 w-12 rounded-full md:h-5 md:w-9" />
            )}
          </SettingsRow>
          <SettingsRow
            label="Volume"
            description="Adjusting it while muted turns the music back on."
            stack
          >
            {mounted ? (
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(music.volume * 100)}
                onChange={(event) => music.setVolume(Number(event.currentTarget.value) / 100)}
                aria-label="Background music volume"
                className="block h-11 w-full cursor-pointer sm:w-48 md:h-5"
                style={{ accentColor: 'var(--st-accent)' }}
              />
            ) : (
              <Skeleton className="h-11 w-full rounded-full sm:w-48 md:h-5" />
            )}
          </SettingsRow>
        </SettingsSection>
      )}
    </div>
  )
}
