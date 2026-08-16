'use client'

// User search for the nav shell — the X-style "find people" box.
// One component, three skins matching the chrome it lives in:
//   chip   → icon button in the top bar, panel with the input inside
//   rail   → command-rail row, panel flies out to the right
//   drawer → mobile-drawer row, input + results expand in normal flow
//            (the 280px drawer can't host a floating ~320px panel)
// All variants share the debounced lookup, keyboard navigation
// (↑/↓/Enter), and the "/" shortcut. Results are plain links so
// cmd-click and middle-click keep working.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { formatNumber } from '@/components/dashboard-v2/format'
import { Avatar } from '@/components/leaderboard/Avatar'
import { IconLock, IconSearch } from '@/components/leaderboard/icons'
import type { UserSearchResult } from '@/types/profile'

const DEBOUNCE_MS = 250

/** The top bar shows the search chip only where finding a person is the
 * page's job: your own profile, public profiles (/u/…) and the
 * leaderboard. Everywhere else the bar stays clean — the rail keeps its
 * always-on search row for the rest of the app. */
export function isUserSearchRoute(pathname: string): boolean {
  return (
    pathname === '/profile' ||
    pathname.startsWith('/u/') ||
    pathname === '/leaderboard' ||
    pathname.startsWith('/leaderboard/')
  )
}

type SearchPhase = 'idle' | 'searching' | 'done' | 'error'

function useUserSearchQuery() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [phase, setPhase] = useState<SearchPhase>('idle')
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    const id = ++seq.current
    if (!q) {
      setResults([])
      setPhase('idle')
      return
    }
    setPhase('searching')
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
          cache: 'no-store'
        })
        if (id !== seq.current) return
        if (!res.ok) throw new Error('search failed')
        const data = await res.json()
        if (id !== seq.current) return
        setResults(Array.isArray(data.users) ? (data.users as UserSearchResult[]) : [])
        setPhase('done')
      } catch {
        if (id !== seq.current) return
        setResults([])
        setPhase('error')
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  return { query, setQuery, results, phase }
}

function PanelStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center text-[10px] tracking-[0.3em] text-zinc-500">
      {children}
    </div>
  )
}

function ResultRows({
  query,
  results,
  phase,
  activeIndex,
  onHover,
  onNavigate
}: {
  query: string
  results: UserSearchResult[]
  phase: SearchPhase
  activeIndex: number
  onHover: (index: number) => void
  onNavigate: () => void
}) {
  const q = query.trim()

  if (!q) {
    return (
      <div className="px-5 py-7 text-center">
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full liquid-glass-inset text-zinc-500">
          <IconSearch size={14} />
        </span>
        <div className="mt-3 text-[10px] tracking-[0.3em] text-zinc-300">FIND USERS</div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Search by handle or display name.
        </p>
      </div>
    )
  }
  if (phase === 'error') return <PanelStatus>SEARCH UNAVAILABLE</PanelStatus>
  if (results.length === 0) {
    return phase === 'searching' ? (
      <PanelStatus>SCANNING…</PanelStatus>
    ) : (
      <PanelStatus>NO USERS FOUND</PanelStatus>
    )
  }

  return (
    <div className="max-h-[min(60vh,380px)] overflow-y-auto py-1">
      {results.map((user, i) => (
        <Link
          key={user.userId}
          href={`/u/${encodeURIComponent(user.username)}`}
          onClick={onNavigate}
          onMouseEnter={() => onHover(i)}
          className={`flex w-full items-center gap-3 px-3.5 py-2.5 transition-colors ${
            i === activeIndex ? 'bg-white/[0.06]' : ''
          }`}
        >
          <Avatar
            src={user.profile_image}
            char={user.username[0]?.toUpperCase() ?? '?'}
            imgClassName="h-8 w-8 shrink-0 rounded-full border border-zinc-800 object-cover"
            fallbackClassName="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-xs text-zinc-400"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-display text-[12px] font-medium tracking-tight text-zinc-100">
                {user.display_name}
              </span>
              {user.isPrivate && (
                <span className="shrink-0 text-zinc-500" title="Private account">
                  <IconLock size={10} />
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
              @{user.username}
            </span>
          </span>
          {user.score > 0 && (
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
              {formatNumber(user.score)}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}

export function UserSearch({
  variant,
  className = '',
  enabled = true
}: {
  variant: 'chip' | 'rail' | 'drawer'
  className?: string
  /** Lets host chrome that stays mounted while hidden (the mobile drawer
   * slides offscreen but never unmounts) park this instance: the panel
   * closes and the "/" shortcut ignores it. The getClientRects guard
   * can't catch that case — a translated-away element still has boxes. */
  enabled?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { query, setQuery, results, phase } = useUserSearchQuery()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setActiveIndex(0), [results])

  // Navigation landed somewhere new — put the panel away.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Host chrome slid shut — close too, so a stale panel isn't sitting
  // open (with old results) when the chrome comes back.
  useEffect(() => {
    if (!enabled) setOpen(false)
  }, [enabled])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // "/" jumps to search, X-style. Several variants can be mounted at
  // once (top bar + rail + drawer); only the one actually rendered —
  // and not parked by its host — reacts.
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const root = rootRef.current
      if (!root || root.getClientRects().length === 0) return
      e.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const closeAfterNavigate = useCallback(() => {
    setOpen(false)
    inputRef.current?.blur()
  }, [])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const target = results[activeIndex]
      if (target) {
        e.preventDefault()
        closeAfterNavigate()
        router.push(`/u/${encodeURIComponent(target.username)}`)
      }
    }
  }

  const inputProps = {
    ref: inputRef,
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
      setOpen(true)
    },
    onKeyDown: onInputKeyDown,
    placeholder: 'SEARCH USERS',
    spellCheck: false,
    autoComplete: 'off' as const,
    'aria-label': 'Search users'
  }

  const rows = (
    <ResultRows
      query={query}
      results={results}
      phase={phase}
      activeIndex={activeIndex}
      onHover={setActiveIndex}
      onNavigate={closeAfterNavigate}
    />
  )

  /* ---------------- rail row + side flyout ---------------- */

  if (variant === 'rail') {
    return (
      <div ref={rootRef} className={`relative ${className}`}>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => {
              const next = !v
              if (next) requestAnimationFrame(() => inputRef.current?.focus())
              return next
            })
          }}
          aria-label="Search users"
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`nav-row relative mx-2 flex h-10 w-[calc(100%-16px)] shrink-0 items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
            open
              ? 'bg-white/[0.06] text-zinc-100'
              : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08]'
          }`}
        >
          <span className="flex w-12 shrink-0 items-center justify-center">
            <IconSearch className="h-[17px] w-[17px]" />
          </span>
          <span className="nav-label-clip">
            <span className="nav-label text-[10px] tracking-[0.25em]">
              SEARCH
              <span className="ml-auto pr-4 text-[9px] tracking-[0.1em] text-zinc-600">/</span>
            </span>
          </span>
          <span className="nav-tip glass-pop rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.3em] text-zinc-200">
            SEARCH · /
          </span>
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Search users"
            className="absolute left-full top-0 z-50 ml-3 w-[320px] origin-top-left overflow-hidden rounded-xl glass-pop"
            style={{ animation: 'glass-pop-in-side 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
          >
            <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-2.5">
              <span className="text-zinc-600">
                <IconSearch size={13} />
              </span>
              <input
                {...inputProps}
                className="min-w-0 flex-1 bg-transparent py-0.5 text-[12px] text-zinc-100 placeholder:text-[9px] placeholder:tracking-[0.3em] placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            {rows}
          </div>
        )}
      </div>
    )
  }

  /* ---------------- drawer row + inline panel ---------------- */

  // The drawer variant expands in normal flow (disclosure, not a floating
  // dialog): the input and result rows push the nav list down and scroll
  // with it, since a 280px slide-over has no room to anchor a flyout.
  if (variant === 'drawer') {
    return (
      <div ref={rootRef} className={className}>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => {
              const next = !v
              if (next) requestAnimationFrame(() => inputRef.current?.focus())
              return next
            })
          }}
          aria-label="Search users"
          aria-expanded={open}
          className={`relative mx-2 mb-1 flex h-11 w-[calc(100%-16px)] items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
            open
              ? 'bg-white/[0.06] text-zinc-100'
              : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 active:bg-white/[0.08]'
          }`}
        >
          <span className="flex w-12 shrink-0 items-center justify-center">
            <IconSearch className="h-[17px] w-[17px]" />
          </span>
          <span className="text-[10px] tracking-[0.3em]">SEARCH</span>
        </button>

        {open && (
          <div className="mx-2 mb-1 overflow-hidden rounded-lg glass-inset-lite">
            <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-2.5">
              <span className="text-zinc-600">
                <IconSearch size={13} />
              </span>
              <input
                {...inputProps}
                className="min-w-0 flex-1 bg-transparent py-0.5 text-[12px] text-zinc-100 placeholder:text-[9px] placeholder:tracking-[0.3em] placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            {rows}
          </div>
        )}
      </div>
    )
  }

  /* ---------------- top-bar chip ---------------- */

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v
            if (next) requestAnimationFrame(() => inputRef.current?.focus())
            return next
          })
        }}
        aria-label="Search users"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative flex items-center justify-center rounded border px-2.5 py-[5px] transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
          open
            ? 'border-zinc-500 bg-white/[0.06] text-zinc-100'
            : 'border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-white/[0.04] hover:text-zinc-100 active:bg-white/[0.07]'
        }`}
      >
        <IconSearch className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Search users"
          className="absolute right-0 top-full z-50 mt-2 w-[min(88vw,320px)] origin-top-right overflow-hidden rounded-xl glass-pop"
          style={{ animation: 'glass-pop-in 180ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
        >
          <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-2.5">
            <span className="text-zinc-600">
              <IconSearch size={13} />
            </span>
            <input
              {...inputProps}
              className="min-w-0 flex-1 bg-transparent py-0.5 text-[12px] text-zinc-100 placeholder:text-[9px] placeholder:tracking-[0.3em] placeholder:text-zinc-600 focus:outline-none"
            />
            <kbd className="hidden rounded border border-zinc-800 px-1 text-[9px] leading-4 text-zinc-600 md:block">
              /
            </kbd>
          </div>
          {rows}
        </div>
      )}
    </div>
  )
}
