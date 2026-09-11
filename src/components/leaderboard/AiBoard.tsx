'use client'

// THE AI LEADERBOARD — the arena's second board: not pilots but the
// machines themselves, ranked by every pilot's combined verified usage
// (via /api/leaderboard/ai, one cached site-wide aggregate). Two slabs
// in the register of the AGI Bar drinks menu that inspired it: a deep
// navy sheet inside a clean amber frame, the title bar across the top,
// and — on desktop — the house machine on the left, centred on its own
// axis with air between its blocks, beside the list on the right. One
// accent (amber) for structure and figures, orange only where the menu
// puts it (the mark, the cursor, the top three), white for names, grey
// for labels. No green, no glow, no radius. All-mono type at sizes a
// leaderboard can be read at, on rows tall enough to breathe.
//
// The machine list is the top 25 of whatever the controls leave in. The
// second slab, AGENTS, ranks the coding harnesses the extension never
// sees (Codex, Claude Code, OpenCode…) by the USD their opted-in
// collectors report — a separate currency, so a separate list.
//
// The viewer's most-used AI is their machine: an orange rail on its row,
// a YOU tag, and the docked strip below. The payload is identical for
// every viewer and refreshes server-side every 5 minutes, so there is no
// poll: fetch on mount and when the tab regains focus. It embeds BOTH
// ranking windows (season + all-time); the toggles switch locally.
//
// This file is composition, state and the stylesheet. The pieces live
// in ./ai: title bars, featured panel, prompt + controls, table + rows +
// spec sheet, agents slab, dock, and the motion module.

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  sortTools,
  TOP_N,
  windowLabel,
  type AiCategoryFilter,
  type AiSortDir,
  type AiSortKey,
  type AiStatus,
  type AiWindowId
} from '@/components/leaderboard/ai/aiBoardState'
import {
  flipRows,
  mountChrome,
  mountContent,
  snapshotRows,
  type RowsSnapshot
} from '@/components/leaderboard/ai/aiMotion'
import { AiAgents } from '@/components/leaderboard/ai/AiAgents'
import { AiDock } from '@/components/leaderboard/ai/AiDock'
import { AiFeatured, AiFeaturedSkeleton } from '@/components/leaderboard/ai/AiFeatured'
import { AiPrompt } from '@/components/leaderboard/ai/AiPrompt'
import { AiTable, type AiTableState } from '@/components/leaderboard/ai/AiTable'
import { AiTitleBar } from '@/components/leaderboard/ai/AiTitleBar'
import { leaderboardScrollTo } from '@/components/leaderboard/LeaderboardScrollRuntime'
import type { AiBoards } from '@/lib/aiLeaderboard'
import {
  AI_CATEGORY_LABEL,
  AI_CATEGORY_ORDER,
  aiToolMeta,
  type AiToolMeta
} from '@/lib/aiToolOrgs'
import { SCORE_POLICY } from '@/lib/scoring'

gsap.registerPlugin(useGSAP, Flip)

export function AiBoard({
  viewerUserId = null,
  viewerTopTool
}: {
  viewerUserId?: number | null
  /** Viewer's #1 tool from the standings payload. undefined = unknown
   *  yet (render no dock); null = known-empty (AiBoard falls back to
   *  the profile endpoint when a viewer id exists). */
  viewerTopTool?: string | null
}) {
  const [boards, setBoards] = useState<AiBoards | null>(null)
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [windowId, setWindowId] = useState<AiWindowId>('season')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<AiCategoryFilter>('all')
  const [sort, setSort] = useState<AiSortKey>('score')
  const [sortDir, setSortDir] = useState<AiSortDir>('desc')
  const [openName, setOpenName] = useState<string | null>(null)

  // Once the player picks a window, focus-refetches must not yank the
  // toggle back to the default.
  const userPicked = useRef(false)

  // Monotonic guard, same as the global board: a slow response must
  // never overwrite a newer one.
  const fetchSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const res = await fetch('/api/leaderboard/ai', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (seq !== fetchSeq.current) return
      if (!res.ok || !data?.success || !data.boards?.alltime) {
        setFailed(true)
        return
      }
      const nextBoards = data.boards as AiBoards
      setBoards(nextBoards)
      // SEASON is the default only while a live season board exists;
      // during intermission (or before a calendar) it disappears and
      // ALL-TIME fronts the page.
      setWindowId((current) => {
        if (!nextBoards.season) return 'alltime'
        return userPicked.current ? current : 'season'
      })
      const number = data.season?.current?.number
      setSeasonNumber(typeof number === 'number' ? number : null)
      setGeneratedAt(
        typeof data.generatedAt === 'string' ? data.generatedAt : null
      )
      setFailed(false)
    } catch {
      if (seq === fetchSeq.current) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load])

  // ---- the viewer's machine ---------------------------------------
  // A ranked viewer arrives with topTools on the standings payload; an
  // unranked one (null + a viewer id) resolves through the profile
  // endpoint. undefined = still unknown → no dock, no flash.
  const [fallbackTool, setFallbackTool] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (viewerTopTool !== null || viewerUserId == null) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/leaderboard/profile?userId=${viewerUserId}`, {
          cache: 'no-store',
          credentials: 'include'
        })
        const data = res.ok ? await res.json().catch(() => null) : null
        if (cancelled) return
        const name = data?.success ? data.profile?.topTools?.[0]?.name : null
        setFallbackTool(typeof name === 'string' && name ? name : null)
      } catch {
        if (!cancelled) setFallbackTool(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewerTopTool, viewerUserId])

  const viewerFaction: string | null | undefined =
    typeof viewerTopTool === 'string'
      ? viewerTopTool
      : viewerTopTool === null && viewerUserId != null
        ? fallbackTool
        : undefined

  // ---- the active window ------------------------------------------
  // A stale 'season' pick after the season board vanished falls back
  // to all-time.
  const board =
    boards === null
      ? null
      : windowId === 'season' && boards.season
        ? boards.season
        : boards.alltime
  const activeWindow: AiWindowId =
    windowId === 'season' && boards?.season ? 'season' : 'alltime'
  const tools = board?.tools ?? null
  const totals = board?.totals ?? null
  // A cached pre-agents payload may still be in flight for a few minutes.
  const agents = board?.agents ?? []

  const loading = boards === null && !failed
  const status: AiStatus = boards
    ? failed
      ? 'stale'
      : 'live'
    : failed
      ? 'offline'
      : 'sync'

  // Org + category per tool, resolved once per payload for both windows.
  const metaByName = useMemo(() => {
    const map = new Map<string, AiToolMeta>()
    for (const list of [boards?.alltime.tools, boards?.season?.tools]) {
      for (const tool of list ?? []) {
        if (!map.has(tool.name)) map.set(tool.name, aiToolMeta(tool.name))
      }
    }
    return map
  }, [boards])
  const metaFor = useCallback(
    (name: string) => metaByName.get(name) ?? aiToolMeta(name),
    [metaByName]
  )

  // Category chips only offer what this window actually holds; a pick
  // that vanished with a window switch reads as ALL rather than empty.
  const categories = useMemo(() => {
    const present = new Set((tools ?? []).map((tool) => metaFor(tool.name).category))
    return AI_CATEGORY_ORDER.filter((id) => present.has(id))
  }, [tools, metaFor])
  const activeCategory: AiCategoryFilter =
    category !== 'all' && !categories.includes(category) ? 'all' : category

  // Filter and sort over the whole window, then the top-25 cut.
  const { visible, matched } = useMemo(() => {
    if (!tools) return { visible: [], matched: 0 }
    const q = query.trim().toLowerCase()
    const filtered = tools.filter((tool) => {
      const meta = metaFor(tool.name)
      if (activeCategory !== 'all' && meta.category !== activeCategory) return false
      if (!q) return true
      return (
        tool.name.toLowerCase().includes(q) || meta.org.toLowerCase().includes(q)
      )
    })
    return {
      visible: sortTools(filtered, sort, sortDir).slice(0, TOP_N),
      matched: filtered.length
    }
  }, [tools, query, activeCategory, sort, sortDir, metaFor])

  const featured = tools?.[0] ?? null
  const runnerUp = tools?.[1] ?? null

  const yourRow = useMemo(
    () =>
      typeof viewerFaction === 'string' && tools
        ? tools.find((tool) => tool.name === viewerFaction) ?? null
        : null,
    [tools, viewerFaction]
  )

  const tableState: AiTableState = loading
    ? 'loading'
    : failed && !boards
      ? 'error'
      : visible.length === 0
        ? 'empty'
        : 'ready'

  const emptyLabel = query.trim()
    ? `no machines match "${query.trim()}"`
    : activeCategory !== 'all'
      ? `no machines in ${AI_CATEGORY_LABEL[activeCategory]}`
      : 'no machines on the board yet'

  // ---- motion -------------------------------------------------------
  const rootRef = useRef<HTMLElement>(null)

  // Chrome draws once on mount, around the skeleton.
  useGSAP(
    () => {
      if (rootRef.current) mountChrome(rootRef.current)
    },
    { scope: rootRef }
  )

  // Content cascades once, the first time rows exist.
  const contentPlayed = useRef(false)
  const ready = tableState === 'ready'
  useGSAP(
    () => {
      if (!ready || contentPlayed.current || !rootRef.current) return
      contentPlayed.current = true
      mountContent(rootRef.current)
    },
    { scope: rootRef, dependencies: [ready] }
  )

  // Re-sort: a control handler snapshots the rows before it commits;
  // the layout effect after that commit flips them into place. The nonce
  // (not the row order) drives the effect so a snapshot never goes stale
  // behind a change that happened to leave the order alone.
  const flipSnap = useRef<RowsSnapshot | null>(null)
  const [flipNonce, setFlipNonce] = useState(0)
  const reflow = useCallback((mutate: () => void) => {
    if (rootRef.current) flipSnap.current = snapshotRows(rootRef.current)
    mutate()
    setFlipNonce((n) => n + 1)
  }, [])
  const { contextSafe } = useGSAP({ scope: rootRef })
  const runFlip = useMemo(
    () =>
      contextSafe((snap: RowsSnapshot) => {
        if (rootRef.current) flipRows(snap, rootRef.current)
      }),
    [contextSafe]
  )
  useLayoutEffect(() => {
    const snap = flipSnap.current
    if (!snap) return
    flipSnap.current = null
    runFlip(snap)
  }, [flipNonce, runFlip])

  const onWindow = useCallback(
    (next: AiWindowId) =>
      reflow(() => {
        userPicked.current = true
        setWindowId(next)
      }),
    [reflow]
  )
  const onCategory = useCallback(
    (next: AiCategoryFilter) => reflow(() => setCategory(next)),
    [reflow]
  )
  const onQuery = useCallback((next: string) => reflow(() => setQuery(next)), [reflow])
  const onSort = useCallback(
    (key: AiSortKey) =>
      reflow(() => {
        if (key === sort) {
          setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))
        } else {
          setSort(key)
          setSortDir('desc')
        }
      }),
    [reflow, sort]
  )

  // ---- spec sheet: one open at a time, Esc closes -----------------
  const onToggle = useCallback(
    (name: string) => setOpenName((current) => (current === name ? null : name)),
    []
  )
  useEffect(() => {
    if (openName === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenName(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openName])

  // ---- your-machine jump: scroll the row into view, open its sheet --
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const setRowRef = useCallback((name: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(name, el)
    else rowRefs.current.delete(name)
  }, [])

  const pendingJump = useRef<string | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)

  const jumpToYourMachine = useCallback(() => {
    const target = yourRow
    if (!target || target.rank > TOP_N) return
    pendingJump.current = target.name
    setOpenName(target.name)
    // A live filter, category pick or sort may be hiding the row we're
    // about to scroll to; the official order always seats a top-25 rank.
    setQuery('')
    setCategory('all')
    setSort('score')
    setSortDir('desc')
    setJumpNonce((n) => n + 1)
  }, [yourRow])

  useLayoutEffect(() => {
    const name = pendingJump.current
    if (name == null) return
    const el = rowRefs.current.get(name)
    if (!el) return // row still filtered out — the next commit retries
    pendingJump.current = null
    // Instant, not smooth: the sheet expands in the same commit. Routed
    // through the leaderboard smoother when it's live (a native
    // scrollIntoView would fight the transform-based smoothing),
    // scrollIntoView otherwise.
    leaderboardScrollTo(el, false)
  }, [visible, jumpNonce])

  const retry = useCallback(() => {
    setFailed(false)
    setBoards(null)
    void load()
  }, [load])

  const windowName = windowLabel(activeWindow, seasonNumber)

  const hasFeatured = featured !== null || loading

  return (
    <section ref={rootRef} className="aib" aria-label="AI leaderboard">
      {/* ---------------- the header strip ---------------- */}
      <div className="aib-slab aib-head">
        <AiTitleBar
          machines={tools?.length ?? 0}
          players={totals?.pilots ?? 0}
          points={totals?.score ?? 0}
          windowLabel={windowName}
          generatedAt={generatedAt}
          status={status}
        />
      </div>

      {/* ---------------- the cards: [featured + agents] | machines ---------------- */}
      <div className="aib-body" data-featured={hasFeatured || undefined}>
        <div className="aib-side">
          {hasFeatured && (
            <div className="aib-slab aib-house">
              {featured ? (
                <AiFeatured
                  tool={featured}
                  meta={metaFor(featured.name)}
                  runnerUp={runnerUp}
                  windowLabel={windowName}
                  machines={tools?.length ?? 0}
                />
              ) : (
                <AiFeaturedSkeleton />
              )}
            </div>
          )}
          {board && <AiAgents agents={agents} windowLabel={windowName} />}
        </div>

        <div className="aib-slab aib-machines">
          <AiPrompt
            window={activeWindow}
            hasSeason={Boolean(boards?.season)}
            onWindow={onWindow}
            sort={sort}
            sortDir={sortDir}
            category={activeCategory}
            categories={categories}
            onCategory={onCategory}
            query={query}
            onQuery={onQuery}
            shown={visible.length}
            matched={matched}
          />
          <AiTable
            state={tableState}
            rows={visible}
            tools={tools ?? []}
            metaFor={metaFor}
            sort={sort}
            sortDir={sortDir}
            onSort={onSort}
            openName={openName}
            onToggle={onToggle}
            viewerFaction={typeof viewerFaction === 'string' ? viewerFaction : null}
            setRowRef={setRowRef}
            emptyLabel={emptyLabel}
            onRetry={retry}
          />
          <p className="aib-foot">
            SCORE = VERIFIED ACTIVE SECONDS + {SCORE_POLICY.visitPoints} / VISIT · TOP {TOP_N}
            {tools ? ` OF ${tools.length}` : ''} MACHINES · REFRESHES EVERY 5 MIN
          </p>
        </div>
      </div>

      {/* Docked strip: only once the viewer's machine is known and the
          board has rows to jump to (stale rows still count). */}
      {tools !== null && viewerFaction !== undefined && (
        <AiDock
          tool={yourRow}
          org={yourRow ? metaFor(yourRow.name).org : '—'}
          onJump={jumpToYourMachine}
        />
      )}

      <style jsx global>{`
        /* ================= tokens =================
           The slab is dark in both themes. Every length is written in
           --u, which folds two things together: the page's md+ zoom (0.9),
           undone so a nominal 16px is not silently 14.4; and the board's
           own scale, 0.92 — the design was drawn at 100% and tuned down a
           notch, so a "16px" name renders at ~14.7px everywhere. */
        .aib {
          --aib-scale: 0.92;
          --u: calc(var(--aib-scale) * 1px);
          --aib-bg: 10 13 22;
          --aib-bg-2: 14 18 30;
          --aib-edge: 214 218 228;
          --aib-ink: 241 240 235;
          --aib-ink-2: 156 163 178;
          --aib-amber: 246 196 66;
          --aib-orange: 249 130 30;
          --aib-cream: 247 240 216;
          --aib-frame: rgb(var(--aib-amber) / 0.85);
          --aib-rule: rgb(var(--aib-amber) / 0.32);
          --aib-hair: rgb(var(--aib-ink) / 0.1);
          --aib-mono: var(--font-data), ui-monospace, 'SF Mono', Menlo, monospace;
          --aib-pixel: var(--font-pixel), ui-monospace, monospace;
          --aib-feat-w: calc(340 * var(--u));
          --aib-pad: calc(24 * var(--u));
          --aib-gap: calc(20 * var(--u));
          position: relative;
          color: rgb(var(--aib-ink));
          color-scheme: dark;
          font-family: var(--aib-mono);
          font-size: calc(14 * var(--u));
          line-height: 1.45;
          font-variant-numeric: tabular-nums;
          /* the typewriter splits characters; kerning would shift them */
          font-kerning: none;
        }
        @media (min-width: 768px) {
          .aib {
            --u: calc(var(--aib-scale) * 1px / 0.9);
          }
        }
        @media (min-width: 1280px) {
          .aib {
            --aib-feat-w: calc(380 * var(--u));
          }
        }
        .aib,
        .aib * {
          border-radius: 0;
        }
        .aib :focus-visible {
          outline: 1px solid rgb(var(--aib-amber));
          outline-offset: -1px;
        }
        /* :where() keeps this reset at class-level specificity, so the
           margins the components set on their own <p>/<dl>/<dd> (.aib-spec,
           .aib-sheet-grid, .aib-sheet-cell dd, .aib-featured-meta…) win
           over it instead of being silently zeroed. */
        .aib :where(p, dl, dd, h2) {
          margin: 0;
        }
        .aib-amber {
          color: rgb(var(--aib-amber));
        }

        /* the frame: one clean amber line, a navy sheet inside. Every
           component is its own framed card; --aib-gap is the air between. */
        .aib-slab {
          background: rgb(var(--aib-bg));
          border: 1px solid var(--aib-frame);
        }
        .aib-head + .aib-body,
        .aib-body + .aib-dock {
          margin-top: var(--aib-gap);
        }

        /* rules are real elements so the mount cascade can draw them */
        .aib-rule-x {
          display: block;
          height: 1px;
          background: var(--aib-rule);
        }

        .aib-tag {
          display: inline-block;
          padding: calc(5 * var(--u)) calc(10 * var(--u));
          border: 1px solid currentColor;
          font-size: calc(11 * var(--u));
          line-height: 1.2;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .aib-cursor {
          display: inline-block;
          width: 0.6em;
          height: 0.95em;
          margin-left: 0.3em;
          vertical-align: -0.1em;
          background: rgb(var(--aib-orange));
        }

        /* ================= title bar ================= */
        .aib-titlebar {
          display: flex;
          align-items: center;
          gap: calc(12 * var(--u));
          min-height: calc(52 * var(--u));
          padding: calc(12 * var(--u)) var(--aib-pad);
          font-size: calc(14 * var(--u));
          color: rgb(var(--aib-ink-2));
        }
        .aib-titlebar-dot {
          font-size: calc(11 * var(--u));
          color: rgb(var(--aib-amber));
        }
        .aib-titlebar-text {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .aib-titlebar-name {
          font-weight: 600;
          letter-spacing: 0.1em;
          color: rgb(var(--aib-ink));
        }
        .aib-titlebar-num {
          color: rgb(var(--aib-ink));
        }
        .aib-titlebar-sep {
          margin: 0 calc(10 * var(--u));
        }
        .aib-titlebar-stamp {
          flex: none;
          font-size: calc(11 * var(--u));
          letter-spacing: 0.18em;
          white-space: nowrap;
        }
        .aib-titlebar-stamp[data-status='stale'],
        .aib-titlebar-stamp[data-status='offline'] {
          color: rgb(var(--aib-amber));
        }
        /* phones keep the name, the window and the stamp; figures go and
           the bar tightens a notch so "CRIBBLE AI // SEASON 01" stays whole */
        @media (max-width: 767px) {
          .aib-titlebar {
            padding-left: calc(16 * var(--u));
            padding-right: calc(16 * var(--u));
            font-size: calc(13 * var(--u));
          }
          .aib-titlebar-sep {
            margin: 0 calc(6 * var(--u));
          }
          .aib-titlebar-stamp {
            letter-spacing: 0.12em;
          }
          .aib-titlebar-num-opt,
          .aib-titlebar-verb {
            display: none;
          }
        }
        /* players + pts only once the bar is a full desktop width */
        @media (max-width: 1023px) {
          .aib-titlebar-opt {
            display: none;
          }
        }

        /* ================= body: [house + agents] | machines =================
           Below lg the side column dissolves (display: contents) and its
           cards join the one-column stack in reading order: house,
           machines, agents. */
        .aib-body {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: var(--aib-gap);
        }
        .aib-side {
          display: contents;
        }
        .aib-house {
          order: 1;
        }
        .aib-machines {
          order: 2;
          min-width: 0;
        }
        .aib-agents {
          order: 3;
        }
        @media (min-width: 1024px) {
          .aib-body[data-featured] {
            grid-template-columns: var(--aib-feat-w) minmax(0, 1fr);
            align-items: start;
          }
          .aib-body[data-featured] > .aib-side {
            display: flex;
            flex-direction: column;
            gap: var(--aib-gap);
            min-width: 0;
          }
        }

        /* ================= featured (rank 1) =================
           One centre axis, generous vertical rhythm — the house pour. */
        .aib-featured {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: calc(18 * var(--u));
          padding: calc(36 * var(--u)) calc(28 * var(--u)) calc(30 * var(--u));
          text-align: center;
        }
        .aib-featured-tag {
          color: rgb(var(--aib-amber));
        }
        .aib-featured-mark {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: calc(6 * var(--u)) 0;
          color: rgb(var(--aib-orange));
        }
        .aib-featured-mark-lg,
        .aib-featured-mark-sm {
          display: block;
          line-height: 0;
        }
        /* CSS beats the SVG's size attributes, so the mark scales with --u */
        .aib-featured-mark-lg > * {
          width: calc(120 * var(--u));
          height: calc(120 * var(--u));
        }
        .aib-featured-mark-sm > * {
          width: calc(40 * var(--u));
          height: calc(40 * var(--u));
        }
        .aib-featured-mark-sm {
          display: none;
        }
        .aib-featured-name {
          font-family: var(--aib-pixel);
          font-size: calc(28 * var(--u));
          line-height: 1.3;
          color: rgb(var(--aib-ink));
          overflow-wrap: anywhere;
        }
        .aib-featured-name[data-scale='md'] {
          font-size: calc(20 * var(--u));
        }
        .aib-featured-name[data-scale='sm'] {
          font-size: calc(15 * var(--u));
        }
        .aib-featured-meta {
          margin-top: calc(-8 * var(--u));
          font-size: calc(15 * var(--u));
          color: rgb(var(--aib-ink) / 0.88);
        }
        .aib-featured-caps {
          margin-top: calc(-6 * var(--u));
          font-size: calc(11 * var(--u));
          letter-spacing: 0.2em;
          color: rgb(var(--aib-ink-2));
        }
        .aib-featured-foot {
          font-size: calc(11 * var(--u));
          letter-spacing: 0.24em;
          color: rgb(var(--aib-ink-2));
        }

        /* the spec box — base / key / model / ctx / rig, but ours. Framed
           in cream rather than amber so it reads as the one white-bordered
           element inside the amber card, and set in the pixel face: the
           read-out is the machine's nameplate, same voice as the name. */
        .aib-spec {
          width: 100%;
          margin-top: calc(6 * var(--u));
          border: 1px solid rgb(var(--aib-cream) / 0.9);
          text-align: left;
        }
        .aib-spec-row {
          display: grid;
          grid-template-columns: calc(80 * var(--u)) minmax(0, 1fr);
          align-items: baseline;
          gap: calc(12 * var(--u));
          padding: calc(14 * var(--u)) calc(16 * var(--u));
          border-top: 1px solid rgb(var(--aib-cream) / 0.28);
        }
        .aib-spec-row:first-child {
          border-top: 0;
        }
        .aib-spec-row dt {
          font-family: var(--aib-pixel);
          font-size: calc(8 * var(--u));
          line-height: 1.4;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgb(var(--aib-ink-2));
        }
        .aib-spec-row dd {
          font-family: var(--aib-pixel);
          font-size: calc(14 * var(--u));
          font-weight: 400;
          line-height: 1.3;
          color: rgb(var(--aib-amber));
          overflow-wrap: anywhere;
        }

        /* md–lg: the panel sits above the list, so it goes wide — the
           identity centred in the left half, the spec box on the right */
        @media (min-width: 768px) and (max-width: 1023px) {
          .aib-featured {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, calc(360 * var(--u)));
            grid-auto-rows: min-content;
            column-gap: calc(32 * var(--u));
            row-gap: calc(14 * var(--u));
            align-items: start;
            justify-items: center;
            padding: calc(32 * var(--u)) calc(28 * var(--u));
          }
          .aib-featured-mark {
            margin: 0;
          }
          .aib-spec {
            grid-column: 2;
            grid-row: 1 / span 6;
            align-self: center;
            justify-self: stretch;
            margin-top: 0;
          }
        }

        /* < md: compact band — mark, headline, org, three values */
        @media (max-width: 767px) {
          .aib-featured {
            display: grid;
            grid-template-columns: calc(56 * var(--u)) minmax(0, 1fr);
            column-gap: calc(16 * var(--u));
            row-gap: calc(4 * var(--u));
            align-items: center;
            justify-items: start;
            padding: calc(20 * var(--u)) calc(16 * var(--u));
            text-align: left;
          }
          .aib-featured-tag,
          .aib-featured-caps,
          .aib-featured-foot {
            display: none;
          }
          .aib-featured-mark {
            grid-row: 1 / span 2;
            margin: 0;
          }
          .aib-featured-mark-lg {
            display: none;
          }
          .aib-featured-mark-sm {
            display: block;
          }
          .aib-featured-name {
            grid-column: 2;
            font-size: calc(18 * var(--u));
          }
          .aib-featured-name[data-scale='md'],
          .aib-featured-name[data-scale='sm'] {
            font-size: calc(15 * var(--u));
          }
          .aib-featured-meta {
            grid-column: 2;
            margin-top: 0;
            font-size: calc(13 * var(--u));
          }
          .aib-spec {
            display: grid;
            grid-column: 1 / -1;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1px;
            margin-top: calc(14 * var(--u));
            background: rgb(var(--aib-cream) / 0.28);
          }
          .aib-spec-row {
            display: flex;
            flex-direction: column;
            gap: calc(4 * var(--u));
            padding: calc(10 * var(--u)) calc(12 * var(--u));
            border-top: 0;
            background: rgb(var(--aib-bg));
          }
          .aib-spec-row dd {
            font-size: calc(12 * var(--u));
          }
          .aib-spec-row[data-compact-hide] {
            display: none;
          }
        }

        /* ================= prompt + controls ================= */
        .aib-prompt {
          padding: var(--aib-pad) var(--aib-pad) 0;
        }
        /* The tail is the board's state readout: --sort=players
           --category=code is what a control just changed. A terminal wraps
           a long command rather than cutting it, and at 1440 the machines
           card is only ~420px, so nowrap + ellipsis hid exactly those
           flags. The typewriter splits words around chars, so a break
           lands between flags, never inside one. */
        .aib-prompt-line {
          font-size: calc(15 * var(--u));
          line-height: 1.5;
          overflow-wrap: break-word;
          color: rgb(var(--aib-ink));
        }
        .aib-prompt-user {
          color: rgb(var(--aib-ink-2));
        }
        .aib-prompt-cmd {
          font-weight: 500;
          color: rgb(var(--aib-amber));
        }
        .aib-controls {
          margin-top: calc(18 * var(--u));
        }
        .aib-controls-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: calc(10 * var(--u)) calc(16 * var(--u));
        }
        .aib-toggles {
          display: flex;
          gap: calc(10 * var(--u));
        }
        .aib-toggle {
          padding: calc(6 * var(--u)) 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: calc(13 * var(--u));
          letter-spacing: 0.1em;
          color: rgb(var(--aib-ink-2));
          white-space: nowrap;
          cursor: pointer;
        }
        .aib-toggle:hover {
          color: rgb(var(--aib-ink));
        }
        .aib-toggle[aria-selected='true'] {
          color: rgb(var(--aib-amber));
        }
        /* the wrapper only exists for the phone deck; on desktop it is
           transparent to layout so filter and count stay row items */
        .aib-filter-row {
          display: contents;
        }
        .aib-filter {
          display: inline-flex;
          align-items: center;
          gap: calc(8 * var(--u));
          height: calc(38 * var(--u));
          margin-left: auto;
          padding: 0 calc(12 * var(--u));
          border: 1px solid rgb(var(--aib-ink) / 0.22);
        }
        .aib-filter:focus-within {
          border-color: rgb(var(--aib-amber));
        }
        .aib-filter-mark {
          color: rgb(var(--aib-amber));
        }
        .aib-filter input {
          width: calc(120 * var(--u));
          border: 0;
          background: transparent;
          font: inherit;
          font-size: calc(14 * var(--u));
          color: rgb(var(--aib-ink));
          outline: none;
        }
        .aib-filter input::placeholder {
          color: rgb(var(--aib-ink-2));
          opacity: 1;
        }
        .aib-count {
          font-size: calc(11 * var(--u));
          letter-spacing: 0.16em;
          color: rgb(var(--aib-ink-2));
          white-space: nowrap;
        }
        /* spaced, not separated: glyph dividers leave orphans when the row
           wraps, so the rhythm here is gap alone and the active chip's rule */
        .aib-chips {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0 calc(26 * var(--u));
          margin-top: calc(10 * var(--u));
        }
        .aib-chip {
          padding: calc(6 * var(--u)) 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: calc(12 * var(--u));
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgb(var(--aib-ink-2));
          cursor: pointer;
        }
        .aib-chip:hover {
          color: rgb(var(--aib-ink));
        }
        .aib-chip[aria-pressed='true'] {
          color: rgb(var(--aib-amber));
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: calc(5 * var(--u));
        }

        /* ================= the phone deck =================
           Bare words spaced across a 320px column read as debris, so under
           768 the controls become a deck of framed rows that share one
           border, one height and one active state (amber fill, dark text):
             $ rank --window=season --top=25▮
             ┌ SEASON ──────┬ ALL-TIME ─────┐   segmented switch
             ┌ / filter ─────────── 25 / 61 ┐   full-width field, count inside
             [ALL] [CHAT] [CODE] [SEARCH] →     one row, scrolls sideways
           The prompt keeps its "$ rank …" without the host so it stays on
           one line for every default state. */
        @media (max-width: 767px) {
          .aib-prompt-host {
            display: none;
          }
          .aib-controls {
            margin-top: calc(16 * var(--u));
          }
          .aib-controls-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: calc(10 * var(--u));
          }
          .aib-toggles {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0;
            border: 1px solid rgb(var(--aib-ink) / 0.22);
          }
          .aib-toggle {
            height: calc(40 * var(--u));
            padding: 0;
            font-size: calc(12 * var(--u));
            letter-spacing: 0.16em;
            text-align: center;
          }
          .aib-toggle + .aib-toggle {
            border-left: 1px solid rgb(var(--aib-ink) / 0.22);
          }
          .aib-toggle[aria-selected='true'] {
            background: rgb(var(--aib-amber));
            color: rgb(var(--aib-bg));
          }
          .aib-toggle-bracket {
            display: none;
          }
          .aib-filter-row {
            display: flex;
            align-items: center;
            height: calc(40 * var(--u));
            border: 1px solid rgb(var(--aib-ink) / 0.22);
          }
          .aib-filter-row:focus-within {
            border-color: rgb(var(--aib-amber));
          }
          .aib-filter {
            flex: 1;
            min-width: 0;
            height: 100%;
            margin-left: 0;
            border: 0;
          }
          .aib-filter input {
            flex: 1;
            width: auto;
            min-width: 0;
            /* iOS zooms the page into any focused input under 16px */
            font-size: 16px;
          }
          .aib-count {
            flex: none;
            padding-right: calc(12 * var(--u));
          }
          /* a full-bleed lane: chips run under the card's padding so the cut
             chip at the edge is the scroll affordance; the mask softens it */
          .aib-chips {
            flex-wrap: nowrap;
            gap: calc(8 * var(--u));
            margin: calc(10 * var(--u)) calc(-1 * var(--aib-pad)) 0;
            padding: 0 calc(var(--aib-pad) + 28 * var(--u)) 0 var(--aib-pad);
            overflow-x: auto;
            scroll-snap-type: x proximity;
            /* snap targets align to the content edge, not the bleed edge */
            scroll-padding-left: var(--aib-pad);
            scrollbar-width: none;
            -webkit-mask-image: linear-gradient(
              to right,
              #000 calc(100% - 28 * var(--u)),
              transparent
            );
            mask-image: linear-gradient(to right, #000 calc(100% - 28 * var(--u)), transparent);
          }
          .aib-chips::-webkit-scrollbar {
            display: none;
          }
          .aib-chip {
            flex: none;
            height: calc(34 * var(--u));
            padding: 0 calc(14 * var(--u));
            border: 1px solid rgb(var(--aib-ink) / 0.22);
            font-size: calc(11 * var(--u));
            scroll-snap-align: start;
          }
          .aib-chip[aria-pressed='true'] {
            border-color: rgb(var(--aib-amber));
            background: rgb(var(--aib-amber));
            color: rgb(var(--aib-bg));
            text-decoration: none;
          }
        }

        /* ================= table: one grid, five tracks =================
           Fixed tracks sized to their widest real value ("1,994,145",
           "$167,816", "PLAYERS▾", "100%"); TOOL takes the rest. */
        .aib-table {
          margin-top: calc(22 * var(--u));
        }
        .aib-agents .aib-table {
          margin-top: 0;
        }
        .aib-grid {
          display: grid;
          grid-template-columns: calc(42 * var(--u)) minmax(0, 1fr) calc(96 * var(--u));
          align-items: center;
          column-gap: calc(12 * var(--u));
          padding: 0 calc(16 * var(--u));
        }
        .aib-cell {
          min-width: 0;
        }
        .aib-col-players,
        .aib-col-share {
          display: none;
        }
        @media (min-width: 768px) {
          .aib-grid {
            grid-template-columns:
              calc(52 * var(--u)) minmax(0, 1fr) calc(108 * var(--u)) calc(72 * var(--u))
              calc(84 * var(--u));
            column-gap: calc(14 * var(--u));
            padding: 0 var(--aib-pad);
          }
          .aib-col-players,
          .aib-col-share {
            display: block;
          }
          /* Only the data cell stacks percent over its bar. The SHARE
             header and the skeleton cell share the column class and must
             stay block so text-align: right still pins them to the column
             (a flex header parks its label at the left edge). */
          .aib-share {
            display: flex;
          }
        }
        /* The AGENTS card lives in the 340–380px side column on lg+, so it
           folds to three tracks there — pilots and share move under burn
           (.aib-asub), exactly as they do on phones. Only the md band, where
           the card runs full width with all five columns, hides that line. */
        @media (min-width: 768px) and (max-width: 1023px) {
          .aib-agents .aib-asub {
            display: none;
          }
        }
        @media (min-width: 1024px) {
          .aib-agents .aib-grid {
            grid-template-columns: calc(42 * var(--u)) minmax(0, 1fr) calc(104 * var(--u));
            column-gap: calc(12 * var(--u));
            padding: 0 calc(16 * var(--u));
          }
          .aib-agents .aib-tool {
            gap: calc(10 * var(--u));
          }
          .aib-agents .aib-col-players,
          .aib-agents .aib-col-share {
            display: none;
          }
          .aib-agents .aib-name {
            font-size: calc(15 * var(--u));
          }
          .aib-agents .aib-titlebar-opt,
          .aib-agents .aib-titlebar-num-opt {
            display: none;
          }
          .aib-agents .aib-foot,
          .aib-agents .aib-line {
            padding-left: calc(16 * var(--u));
            padding-right: calc(16 * var(--u));
          }
          .aib-agents .aib-titlebar {
            padding-left: calc(16 * var(--u));
            padding-right: calc(16 * var(--u));
          }
        }
        /* Between lg and xl the side column is 340 wide and the machine card
           ~560: the agents stamp yields to the burn headline (the footnote
           carries the opt-in note), and the machine tracks tighten so the
           TOOL column keeps whole names. */
        @media (max-width: 767px), (min-width: 1024px) and (max-width: 1279px) {
          .aib-agents .aib-titlebar-stamp {
            display: none;
          }
        }
        @media (min-width: 1024px) and (max-width: 1279px) {
          .aib-machines {
            --aib-pad: calc(20 * var(--u));
          }
          /* PLAYERS must hold its own header ("▾PLAYERS" ≈ 70u at 11px /
             0.18em); SHARE only needs "100%" and "▾SHARE" (≈ 53u), so the
             12u move between them, not out of TOOL. */
          .aib-machines .aib-grid {
            grid-template-columns:
              calc(48 * var(--u)) minmax(0, 1fr) calc(100 * var(--u)) calc(72 * var(--u))
              calc(60 * var(--u));
            column-gap: calc(12 * var(--u));
          }
        }

        .aib-thead {
          min-height: calc(40 * var(--u));
          border-bottom: 1px solid var(--aib-rule);
        }
        .aib-th {
          font-size: calc(11 * var(--u));
          letter-spacing: 0.18em;
          text-transform: uppercase;
          text-align: right;
          color: rgb(var(--aib-ink-2));
          white-space: nowrap;
        }
        .aib-th-left {
          text-align: left;
        }
        .aib-th-sort {
          padding: calc(10 * var(--u)) 0;
          border: 0;
          background: none;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          color: inherit;
          cursor: pointer;
        }
        .aib-th-sort:hover,
        .aib-th-sort[data-active] {
          color: rgb(var(--aib-ink));
        }
        /* The glyph sits LEFT of the label (see AiTable) so a right-aligned
           header's text edge lands on its numeric column whether or not it
           is the active sort — the reserved 1ch never pushes the label
           inboard. */
        .aib-th-glyph {
          display: inline-block;
          width: 1ch;
          margin-right: calc(3 * var(--u));
          color: rgb(var(--aib-amber));
          visibility: hidden;
        }
        .aib-th-sort[data-active] .aib-th-glyph {
          visibility: visible;
        }

        .aib-rows {
          position: relative;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .aib-row {
          border-bottom: 1px solid var(--aib-hair);
        }
        .aib-row:last-child {
          border-bottom: 0;
        }
        .aib-rowbtn {
          position: relative;
          width: 100%;
          min-height: calc(60 * var(--u));
          padding-top: calc(10 * var(--u));
          padding-bottom: calc(10 * var(--u));
          border: 0;
          background: none;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .aib-rowflat {
          cursor: default;
        }
        /* the rail: 2px of amber, no shadow, no transition */
        .aib-rowbtn::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 2px;
          background: rgb(var(--aib-amber));
          opacity: 0;
        }
        /* the selected band, the way the menu fills its picked row */
        button.aib-rowbtn:hover,
        button.aib-rowbtn:focus-visible,
        .aib-row[data-open] .aib-rowbtn {
          background: rgb(var(--aib-amber) / 0.06);
        }
        button.aib-rowbtn:hover::before,
        button.aib-rowbtn:focus-visible::before,
        .aib-row[data-open] .aib-rowbtn::before {
          opacity: 1;
        }
        .aib-row[data-yours] .aib-rowbtn::before {
          background: rgb(var(--aib-orange));
          opacity: 1;
        }
        button.aib-rowbtn:hover .aib-tool-mark,
        button.aib-rowbtn:focus-visible .aib-tool-mark {
          color: rgb(var(--aib-amber));
        }

        .aib-idx {
          display: inline-block;
          font-size: calc(15 * var(--u));
          font-weight: 500;
          line-height: 1;
          color: rgb(var(--aib-amber));
          white-space: nowrap;
        }
        .aib-idx[data-top] {
          color: rgb(var(--aib-orange));
        }
        .aib-tool {
          display: flex;
          align-items: center;
          gap: calc(14 * var(--u));
        }
        .aib-tool-mark {
          flex: none;
          color: rgb(var(--aib-ink));
        }
        .aib-tool-text {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: calc(3 * var(--u));
        }
        .aib-tool-line {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: calc(10 * var(--u));
        }
        .aib-name {
          overflow: hidden;
          font-size: calc(16 * var(--u));
          font-weight: 600;
          line-height: 1.25;
          color: rgb(var(--aib-ink));
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .aib-tag-you {
          flex: none;
          padding: calc(3 * var(--u)) calc(7 * var(--u));
          font-size: calc(10 * var(--u));
          color: rgb(var(--aib-orange));
        }
        .aib-sub {
          display: block;
          overflow: hidden;
          font-size: calc(12 * var(--u));
          font-weight: 400;
          line-height: 1.3;
          color: rgb(var(--aib-ink-2));
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .aib-num {
          font-size: calc(15 * var(--u));
          text-align: right;
          white-space: nowrap;
        }
        .aib-score {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: calc(3 * var(--u));
        }
        .aib-score-main {
          font-size: calc(16 * var(--u));
          font-weight: 500;
          line-height: 1.25;
          color: rgb(var(--aib-ink));
        }
        .aib-share {
          flex-direction: column;
          align-items: flex-end;
          gap: calc(7 * var(--u));
        }
        .aib-sharebar {
          display: block;
          width: 100%;
          height: 2px;
          background: rgb(var(--aib-ink) / 0.1);
        }
        .aib-sharebar-fill {
          display: block;
          height: 2px;
          background: rgb(var(--aib-ink) / 0.55);
          transform-origin: 0 50%;
        }
        .aib-row[data-rank='1'] .aib-sharebar-fill {
          background: rgb(var(--aib-amber));
        }

        /* ================= expanded spec sheet ================= */
        .aib-sheet {
          overflow: hidden;
        }
        .aib-sheet-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          /* the hairlines are this gap showing through: size it in --u so
             it stays one whole device pixel under the page's 0.9 zoom
             (a 1px gap between two opaque cells can snap to nothing) */
          gap: calc(1 * var(--u));
          margin: 0 calc(16 * var(--u)) calc(20 * var(--u));
          border: 1px solid rgb(var(--aib-amber) / 0.26);
          background: rgb(var(--aib-amber) / 0.26);
        }
        @media (min-width: 640px) {
          .aib-sheet-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (min-width: 768px) {
          .aib-sheet-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            margin: 0 var(--aib-pad) calc(22 * var(--u));
          }
        }
        .aib-sheet-cell {
          padding: calc(12 * var(--u)) calc(14 * var(--u)) calc(13 * var(--u));
          background: rgb(var(--aib-bg));
        }
        .aib-sheet-cell dt {
          font-size: calc(11 * var(--u));
          letter-spacing: 0.12em;
          color: rgb(var(--aib-ink-2));
        }
        .aib-sheet-cell dd {
          margin-top: calc(5 * var(--u));
          font-size: calc(14 * var(--u));
          line-height: 1.4;
          color: rgb(var(--aib-ink));
          overflow-wrap: anywhere;
        }
        .aib-sheet-line {
          display: block;
        }

        /* ================= states ================= */
        .aib-line {
          padding: calc(28 * var(--u)) var(--aib-pad);
          font-size: calc(14 * var(--u));
          color: rgb(var(--aib-ink-2));
        }
        .aib-error {
          color: rgb(var(--aib-ink));
        }
        .aib-error .aib-toggle {
          margin-left: calc(8 * var(--u));
          color: rgb(var(--aib-amber));
        }
        .aib-skel {
          color: rgb(var(--aib-edge) / 0.4);
          opacity: 0.5;
        }
        .aib-skelrow {
          width: 100%;
          min-height: calc(60 * var(--u));
        }
        .aib-skelrow .aib-skel {
          overflow: hidden;
          font-size: calc(13 * var(--u));
          letter-spacing: -0.05em;
          white-space: nowrap;
        }
        .aib-skel-block {
          display: block;
          border: 1px solid rgb(var(--aib-edge) / 0.25);
        }
        .aib-featured-skel .aib-spec-row dd {
          color: rgb(var(--aib-edge) / 0.4);
        }

        /* ================= footer ================= */
        .aib-foot {
          padding: calc(14 * var(--u)) var(--aib-pad);
          border-top: 1px solid var(--aib-rule);
          font-size: calc(11 * var(--u));
          line-height: 1.7;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgb(var(--aib-ink-2));
        }

        /* ================= dock: sticky strip, near-opaque, no blur ================= */
        .aib-dock-btn {
          display: flex;
          align-items: center;
          gap: calc(14 * var(--u));
          width: 100%;
          min-height: calc(52 * var(--u));
          padding: 0 var(--aib-pad);
          border: 1px solid rgb(var(--aib-amber) / 0.7);
          background: rgb(var(--aib-bg) / 0.97);
          color: rgb(var(--aib-ink));
          font: inherit;
          font-size: calc(14 * var(--u));
          text-align: left;
          cursor: pointer;
        }
        button.aib-dock-btn:hover {
          border-color: rgb(var(--aib-amber));
          background: rgb(var(--aib-bg));
        }
        .aib-dock-static {
          cursor: default;
        }
        .aib-dock-k {
          flex: none;
          font-size: calc(11 * var(--u));
          letter-spacing: 0.18em;
          color: rgb(var(--aib-orange));
          white-space: nowrap;
        }
        .aib-dock-name {
          min-width: 0;
          overflow: hidden;
          font-weight: 600;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .aib-dock-org {
          font-weight: 400;
          color: rgb(var(--aib-ink-2));
        }
        .aib-dock-dots {
          flex: 1;
          min-width: calc(12 * var(--u));
          overflow: hidden;
          color: rgb(var(--aib-ink-2));
          text-align: center;
          white-space: nowrap;
        }
        .aib-dock-note {
          flex: none;
          font-size: calc(11 * var(--u));
          letter-spacing: 0.16em;
          color: rgb(var(--aib-ink-2));
          white-space: nowrap;
        }
        .aib-dock-score {
          flex: none;
          font-weight: 500;
        }
        .aib-dock-delta {
          flex: none;
          color: rgb(var(--aib-ink-2));
        }
        .aib-dock-recruit .aib-dock-name {
          font-weight: 400;
          color: rgb(var(--aib-ink-2));
        }
        @media (max-width: 639px) {
          .aib-dock-org,
          .aib-dock-delta,
          .aib-dock-note {
            display: none;
          }
        }
      `}</style>
    </section>
  )
}
