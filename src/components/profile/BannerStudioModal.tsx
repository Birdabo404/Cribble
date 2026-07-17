'use client'

// Banner Studio — the profile banner editor, split out of the main
// profile editor so banner hunting (search, preview, retries) never
// convolutes the form. Opens from the owner-only EDIT BANNER chip on
// /u/[username] and saves exactly one field: PATCH /api/user/profile
// { banner_image } (the handler merges only the keys present).
//
// Two sources, two tabs:
//   GIF SEARCH — Klipy search/trending through GET /api/gifs (the key
//     never reaches the browser). Animated banners are a Pro perk, so
//     the grid locks with a /shop upsell for free accounts; the server
//     sniff remains the real gate either way. Klipy's API terms require
//     visible attribution — keep the POWERED BY KLIPY line.
//   IMAGE URL — the old paste-a-URL flow, moved here verbatim. Works
//     for everyone (free accounts: static images only).
//
// Same layout system as EditProfileModal: `// HEADER` voice, three type
// sizes, 36px control height, glass-pop shell.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { KlipyGif } from '@/lib/klipy'

const BANNER_URL_MAX = 300
const SEARCH_MAX = 80

type Tab = 'gif' | 'url'

type GifFeedState = 'loading' | 'loading-more' | 'ready' | 'error' | 'offline'

const inputCls =
  'h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent/50 focus:bg-white/[0.05] focus:outline-none'

export function BannerStudioModal({
  initialUrl,
  onClose,
  onSaved
}: {
  initialUrl: string
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<Tab>('gif')
  const [pendingUrl, setPendingUrl] = useState(initialUrl.trim())
  const [urlDraft, setUrlDraft] = useState(initialUrl.trim())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPro, setIsPro] = useState<boolean | 'loading'>('loading')

  // GIF feed
  const [search, setSearch] = useState('')
  const [gifs, setGifs] = useState<KlipyGif[]>([])
  const [gifPage, setGifPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [feed, setFeed] = useState<GifFeedState>('loading')
  const seqRef = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Tier for the GIF-tab lock. The server re-validates on save, so a
  // failed fetch only degrades the UI — treat it as free.
  useEffect(() => {
    let cancelled = false
    fetch('/api/user/cosmetics', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setIsPro(data?.success ? data.isPro === true : false)
      })
      .catch(() => {
        if (!cancelled) setIsPro(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadGifs = useCallback(async (term: string, page: number, append: boolean) => {
    const seq = ++seqRef.current
    setFeed(append ? 'loading-more' : 'loading')
    try {
      const res = await fetch(
        `/api/gifs?q=${encodeURIComponent(term)}&page=${page}`,
        { credentials: 'include', cache: 'no-store' }
      )
      if (seq !== seqRef.current) return
      if (res.status === 503) {
        setFeed('offline')
        return
      }
      const data = res.ok ? await res.json() : null
      if (seq !== seqRef.current) return
      if (!data?.success || !Array.isArray(data.gifs)) {
        setFeed('error')
        return
      }
      const incoming = data.gifs as KlipyGif[]
      setGifs((prev) => {
        if (!append) return incoming
        const seen = new Set(prev.map((g) => g.id))
        return [...prev, ...incoming.filter((g) => !seen.has(g.id))]
      })
      setGifPage(page)
      setHasNext(data.hasNext === true)
      setFeed('ready')
    } catch {
      if (seq === seqRef.current) setFeed('error')
    }
  }, [])

  // Debounced search; empty term = Klipy trending. Locked (free) and
  // undecided tiers never fetch, so the quota is spent on Pro only.
  useEffect(() => {
    if (isPro !== true || tab !== 'gif') return
    const timer = setTimeout(() => loadGifs(search, 1, false), search ? 350 : 0)
    return () => clearTimeout(timer)
  }, [search, isPro, tab, loadGifs])

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_image: pendingUrl })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Save failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  const select = (url: string) => {
    setPendingUrl(url)
    setUrlDraft(url)
  }

  const gifLocked = isPro === false

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Edit banner"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl glass-pop"
        style={{ animation: 'glass-modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards' }}
      >
        {/* ---------- header ---------- */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent-rgb)/0.7)]" />
            <span className="text-[10px] tracking-[0.4em] text-zinc-200">BANNER STUDIO</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path
                fill="currentColor"
                d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"
              />
            </svg>
          </button>
        </div>

        {/* ---------- body ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* preview */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] tracking-[0.3em] text-zinc-500">PREVIEW</span>
              {pendingUrl && (
                <button
                  type="button"
                  onClick={() => select('')}
                  className="text-[9px] tracking-[0.25em] text-zinc-600 transition-colors hover:text-rose-300"
                >
                  REMOVE BANNER
                </button>
              )}
            </div>
            <BannerPreview url={pendingUrl} />
          </div>

          {/* tabs */}
          <div className="mt-5 grid grid-cols-2 gap-1.5" role="tablist" aria-label="Banner source">
            {(
              [
                { id: 'gif', label: 'GIF SEARCH' },
                { id: 'url', label: 'IMAGE URL' }
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border text-[10px] tracking-[0.3em] transition-colors ${
                  tab === t.id
                    ? 'border-accent/60 bg-accent/10 text-zinc-50'
                    : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {t.label}
                {t.id === 'gif' && gifLocked && <LockGlyph />}
              </button>
            ))}
          </div>

          {/* ---------- GIF SEARCH tab ---------- */}
          {tab === 'gif' && (
            <div className="mt-4">
              {gifLocked ? (
                <ProLockPanel />
              ) : (
                <>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value.slice(0, SEARCH_MAX))}
                    placeholder="Search GIFs… (empty = trending)"
                    className={inputCls}
                    aria-label="Search GIFs"
                  />

                  {isPro === 'loading' || feed === 'loading' ? (
                    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="aspect-video animate-pulse rounded-lg bg-white/[0.04]" />
                      ))}
                    </div>
                  ) : feed === 'offline' ? (
                    <FeedNotice text="GIF SEARCH IS OFFLINE RIGHT NOW" />
                  ) : feed === 'error' ? (
                    <FeedNotice text="GIF SEARCH FAILED">
                      <button
                        type="button"
                        onClick={() => loadGifs(search, 1, false)}
                        className="shrink-0 text-accent transition-colors hover:brightness-110"
                      >
                        RETRY →
                      </button>
                    </FeedNotice>
                  ) : gifs.length === 0 ? (
                    <FeedNotice text="NO GIFS FOUND — TRY ANOTHER SEARCH" />
                  ) : (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {gifs.map((gif) => {
                          const selected = pendingUrl === gif.fullUrl
                          return (
                            <button
                              key={gif.id}
                              type="button"
                              onClick={() => select(gif.fullUrl)}
                              aria-pressed={selected}
                              title={gif.title}
                              className={`relative aspect-video overflow-hidden rounded-lg bg-white/[0.03] transition-shadow ${
                                selected
                                  ? 'ring-2 ring-accent/70 shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)]'
                                  : 'ring-1 ring-white/[0.06] hover:ring-zinc-600'
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={gif.previewUrl}
                                alt={gif.title || 'GIF'}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            </button>
                          )
                        })}
                      </div>
                      {hasNext && (
                        <button
                          type="button"
                          onClick={() => loadGifs(search, gifPage + 1, true)}
                          disabled={feed === 'loading-more'}
                          className="mt-3 flex h-9 w-full items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-60"
                        >
                          {feed === 'loading-more' ? 'LOADING…' : 'LOAD MORE'}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Attribution required by Klipy's API terms of use. */}
              <div className="mt-3 text-center text-[9px] tracking-[0.3em] text-zinc-600">
                POWERED BY{' '}
                <a
                  href="https://klipy.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  KLIPY
                </a>
              </div>
            </div>
          )}

          {/* ---------- IMAGE URL tab ---------- */}
          {tab === 'url' && (
            <div className="mt-4">
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="text-[9px] tracking-[0.3em] text-zinc-500">BANNER IMAGE URL</span>
                  <span className="text-[9px] tracking-[0.15em] text-zinc-600">
                    {gifLocked ? 'GIF/ANIMATED BANNERS REQUIRE PRO' : 'DIRECT LINK TO AN IMAGE'}
                  </span>
                </span>
                <span className="mt-1.5 block">
                  <input
                    value={urlDraft}
                    onChange={(e) => {
                      const next = e.target.value.slice(0, BANNER_URL_MAX)
                      setUrlDraft(next)
                      setPendingUrl(next.trim())
                    }}
                    placeholder="https://…/banner.png"
                    className={inputCls}
                  />
                </span>
              </label>
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                Paste a direct https link to a hosted image. It shows on your profile,
                the leaderboard podium, and your player card.
              </p>
            </div>
          )}
        </div>

        {/* ---------- footer ---------- */}
        <div className="flex items-center gap-3 border-t border-white/[0.08] px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[10px] text-rose-300" role="alert">
            {error}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-zinc-800 px-4 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-lg bg-accent px-6 text-[10px] font-bold tracking-[0.3em] text-black shadow-[0_0_14px_rgb(var(--accent-rgb)/0.25)] transition-all hover:brightness-110 disabled:opacity-60"
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ================= helpers ================= */

/** Wide strip at the profile-hero aspect; falls back to the duotone
 * gradient placeholder for empty or dead URLs. */
function BannerPreview({ url }: { url: string }) {
  const [dead, setDead] = useState(false)

  useEffect(() => setDead(false), [url])

  const showImage = /^https?:\/\/\S+$/i.test(url) && !dead
  return (
    <div className="relative mt-1.5 h-24 overflow-hidden rounded-lg border border-white/[0.08] sm:h-28">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(120% 140% at 18% -10%, rgb(var(--banner-a) / 0.32), transparent 55%)',
            'radial-gradient(90% 130% at 92% 6%, rgb(var(--banner-b) / 0.24), transparent 60%)',
            'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 24px)',
            'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 24px)'
          ].join(', ')
        }}
      />
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setDead(true)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[9px] tracking-[0.35em] text-zinc-600">
          {url && dead ? 'IMAGE FAILED TO LOAD' : 'NO BANNER'}
        </span>
      )}
    </div>
  )
}

/** Free-tier gate over the GIF grid — upsell, never a hard wall. */
function ProLockPanel() {
  return (
    <a
      href="/shop"
      className="mt-1 flex flex-col items-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-8 text-center transition-colors hover:border-accent/40"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full liquid-glass-inset text-zinc-500">
        <LockGlyph size={15} />
      </span>
      <span className="mt-3 text-[9px] tracking-[0.35em] text-zinc-400">
        ANIMATED BANNERS ARE A PRO PERK
      </span>
      <span className="mt-1.5 max-w-[260px] text-[11px] leading-relaxed text-zinc-600">
        Search millions of GIFs and fly one on your profile with Cribble Pro.
      </span>
      <span className="mt-3 text-[10px] tracking-[0.3em] text-accent">GET PRO →</span>
    </a>
  )
}

function FeedNotice({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-4 text-[10px] tracking-[0.15em] text-zinc-500">
      {text}
      {children}
    </div>
  )
}

function LockGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
