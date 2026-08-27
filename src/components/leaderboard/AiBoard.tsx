'use client'

// THE AI LEADERBOARD — the arena's second board, played as a faction
// war. Not pilots but the machines themselves, ranked by every pilot's
// combined verified usage (via /api/leaderboard/ai, one cached
// site-wide aggregate). Each tool is a house: brand hue, epithet, a
// podium of thrones for the top three, and rows that open a
// holographic ToolCard. The viewer's most-used AI is their team —
// docked bar, brand-tinted row, YOUR TEAM chips. The payload is
// identical for every viewer and refreshes server-side every 5
// minutes, so there is no 15s poll: fetch on mount and when the tab
// regains focus. It embeds BOTH ranking windows (current season +
// all-time); the SEASON/ALL-TIME pills toggle locally with no refetch.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react'
import AnimatedCounter from '@/components/AnimatedCounter'
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatScore
} from '@/components/dashboard-v2/format'
import { LeaderboardSponsorFlip } from '@/components/leaderboard/LeaderboardSponsorFlip'
import { AiPodium } from '@/components/leaderboard/AiPodium'
import {
  IconCrown,
  IconFlame,
  IconRefresh,
  IconSearch,
  IconSwords,
  IconTrophy,
  IconUsers,
  ToolIcon
} from '@/components/leaderboard/icons'
import { ToolCard } from '@/components/leaderboard/ToolCard'
import { medalA, medalFor, medalGlow } from '@/components/leaderboard/types'
import type { AiBoards, AiToolRow } from '@/lib/aiLeaderboard'
import { identityForTool, toolInkRgb } from '@/lib/aiToolIdentity'
import { usdDisplayParts } from '@/lib/tokenLeaderboard'

const ROW_GRID =
  'grid grid-cols-[3.6rem_minmax(0,1fr)_auto] md:grid-cols-[4.2rem_minmax(0,1fr)_6.5rem_6.5rem_5.5rem_6.5rem_10.5rem] items-center gap-3 px-4 md:px-5'

/** The two embedded ranking windows. SEASON only exists while a season
 *  is live — the API sends boards.season: null otherwise. */
type AiWindowId = 'season' | 'alltime'

const AI_WINDOWS: { id: AiWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' }
]

/** Theme split for the house hue: --tb (text/borders/fills) flips to
 *  ink under html.light; washes read the raw --tb-d so light mode gets
 *  pastel tints, not mud. Paired with the .lbai-hue rules below. */
const hueVars = (rgb: string) => ({
  ['--tb-d' as string]: rgb,
  ['--tb-i' as string]: toolInkRgb(rgb)
})

export function AiBoard({
  viewerUserId = null,
  viewerTopTool,
  onInspectChange
}: {
  viewerUserId?: number | null
  /** Viewer's #1 tool from the standings payload. undefined = unknown
   *  yet (render no bar); null = known-empty (AiBoard falls back to the
   *  profile endpoint when a viewer id exists). */
  viewerTopTool?: string | null
  /** Fires when the ToolCard opens/closes so the arena can lb4-freeze. */
  onInspectChange?: (open: boolean) => void
}) {
  const [boards, setBoards] = useState<AiBoards | null>(null)
  const [windowId, setWindowId] = useState<AiWindowId>('season')
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)

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

  // ---- the viewer's faction --------------------------------------
  // A ranked viewer arrives with topTools on the standings payload; an
  // unranked one (null + a viewer id) resolves through the profile
  // endpoint. undefined = still unknown → no bar, no flash.
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

  // ---- ToolCard wiring -------------------------------------------
  const onInspectRef = useRef(onInspectChange)
  onInspectRef.current = onInspectChange

  useEffect(() => {
    onInspectRef.current?.(selectedName !== null)
  }, [selectedName])

  // Unmounting mid-inspect (board tab switch) must release the freeze.
  useEffect(() => () => onInspectRef.current?.(false), [])

  // The active window's board. A stale 'season' pick after the season
  // board vanished falls back to all-time.
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

  const loading = boards === null && !failed
  const apex = tools?.[0] ?? null
  const topScore = apex?.score ?? 0

  // Hottest machine this week — one HEAT pip on the board, tiny.
  const maxWeekScore = useMemo(
    () => tools?.reduce((max, tool) => Math.max(max, tool.weekScore), 0) ?? 0,
    [tools]
  )

  const filtered = useMemo(() => {
    if (!tools) return []
    const q = query.trim().toLowerCase()
    if (!q) return tools
    return tools.filter((tool) => tool.name.toLowerCase().includes(q))
  }, [tools, query])

  // Selected tool resolves from the ACTIVE window's FULL list so an
  // in-flight search can't orphan the open card.
  const selectedTool = useMemo(
    () =>
      selectedName === null || !tools
        ? null
        : tools.find((tool) => tool.name === selectedName) ?? null,
    [tools, selectedName]
  )

  const yourRow = useMemo(
    () =>
      typeof viewerFaction === 'string' && tools
        ? tools.find((tool) => tool.name === viewerFaction) ?? null
        : null,
    [tools, viewerFaction]
  )

  // ---- your-team jump: scroll the row into view, open its card ----
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const setRowRef = useCallback((name: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(name, el)
    else rowRefs.current.delete(name)
  }, [])

  const pendingJump = useRef<string | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)

  const jumpToYourTeam = useCallback(() => {
    const target = yourRow
    if (!target) return
    pendingJump.current = target.name
    setSelectedName(target.name)
    // A live search may be hiding the row we're about to scroll to.
    setQuery('')
    setJumpNonce((n) => n + 1)
  }, [yourRow])

  useLayoutEffect(() => {
    const name = pendingJump.current
    if (name == null) return
    const el = rowRefs.current.get(name)
    if (!el) return // row still filtered out — the next commit retries
    pendingJump.current = null
    // Instant, not smooth: the ToolCard opens in the same commit and its
    // scroll-lock would cut a smooth glide off mid-flight.
    el.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [filtered, jumpNonce])

  return (
    <>
      {/* ---------- stat strip / sponsor flip ---------- */}
      <section className="lbai-reveal">
        <LeaderboardSponsorFlip>
          <div className="lb-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
            <StatCell divider={0} icon={<IconSwords size={11} className="text-zinc-600" />} label="TOOLS RANKED">
              <AnimatedCounter
                value={tools?.length ?? 0}
                duration={1100}
                formatter={(v) => formatNumber(Math.round(v))}
              />
            </StatCell>

            <StatCell divider={1} icon={<IconUsers size={11} className="text-zinc-600" />} label="PLAYERS TRACKED">
              <AnimatedCounter
                value={totals?.pilots ?? 0}
                duration={1100}
                formatter={(v) => formatNumber(Math.round(v))}
              />
            </StatCell>

            <StatCell
              divider={2}
              icon={<IconTrophy size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
              label="COMBINED SCORE"
              valueStyle={{
                color: 'rgb(var(--lb-score))',
                textShadow: '0 0 14px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
              }}
              hint="every player, every tool"
            >
              <AnimatedCounter
                value={totals?.score ?? 0}
                duration={1100}
                formatter={(v) => formatCompact(Math.round(v))}
              />
            </StatCell>

            <StatCell
              divider={3}
              icon={<IconCrown size={11} className="text-[rgb(var(--lb-gold)/0.8)]" />}
              label="APEX TOOL"
              hint={apex ? `${apex.percent}% of the board` : undefined}
            >
              {apex ? (
                <span
                  className="lbai-hue flex items-center justify-center gap-2"
                  style={{ ...hueVars(identityForTool(apex.name).rgb), color: 'rgb(var(--tb))' }}
                >
                  <ToolIcon name={apex.name} size={14} className="shrink-0" />
                  <span className="truncate">{apex.name.toUpperCase()}</span>
                </span>
              ) : (
                <span className="text-zinc-700">—</span>
              )}
            </StatCell>
          </div>
        </LeaderboardSponsorFlip>
      </section>

      {/* ---------- faction standings ---------- */}
      <section
        className={`lbai-reveal relative ${selectedTool ? 'lbai-freeze' : ''}`}
        style={{ ['--rv' as string]: '120ms' }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[11px] font-semibold tracking-[0.45em] text-zinc-300">
              FACTION STANDINGS
            </h2>
            {!loading && !failed && (tools?.length ?? 0) > 0 && (
              <span className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums">
                {tools!.length} MACHINES
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {/* SEASON / ALL-TIME — same nested-pill dialect as the
                standings-window pills; toggles the embedded boards
                locally, no refetch. Hidden while no season is live. */}
            {boards?.season && (
              <div
                className="lb-inset flex items-center gap-0.5 rounded-lg p-0.5"
                role="tablist"
                aria-label="AI leaderboard window"
              >
                {AI_WINDOWS.map((item) => {
                  const active = activeWindow === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        userPicked.current = true
                        setWindowId(item.id)
                      }}
                      className={`rounded-md px-2.5 py-1.5 text-[9px] tracking-[0.2em] transition-colors ${
                        active ? '' : 'text-zinc-600 hover:text-zinc-300'
                      }`}
                      style={
                        active
                          ? {
                              border: '1px solid rgb(var(--lb-gold) / 0.5)',
                              color: 'rgb(var(--lb-gold))',
                              background: 'rgb(var(--lb-gold) / 0.07)'
                            }
                          : { border: '1px solid transparent' }
                      }
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            )}
            <SearchBar value={query} onChange={setQuery} />
            <UpdatedStamp generatedAt={generatedAt} />
          </div>
        </div>

        {/* podium — always the field's top 3, never the hunt's */}
        {!loading && !failed && (tools?.length ?? 0) > 0 && (
          <AiPodium
            top3={tools!.slice(0, 3)}
            viewerTopTool={typeof viewerFaction === 'string' ? viewerFaction : null}
            onSelect={(tool) => setSelectedName(tool.name)}
          />
        )}

        <div className="lb-panel relative overflow-hidden">
          <div
            className={`${ROW_GRID} border-b border-[rgb(var(--lb-panel-edge)/0.08)] py-3 text-[9px] tracking-[0.35em] text-zinc-500`}
          >
            <div>RANK</div>
            <div>TOOL</div>
            <div className="hidden text-right md:block">PLAYERS</div>
            <div className="hidden text-right md:block">TIME</div>
            <div className="hidden text-right md:block">7D</div>
            <div className="hidden text-right md:block">BURN</div>
            <div className="text-right text-zinc-300">SCORE</div>
          </div>

          <ul className="relative">
            {loading &&
              Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} index={i} />)}

            {failed && (
              <li className="flex flex-col items-center gap-4 py-14 text-center">
                <span className="text-xs tracking-[0.15em] text-zinc-500">
                  The machine standings failed to load.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false)
                    setBoards(null)
                    void load()
                  }}
                  className="lb-inset flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] tracking-[0.3em] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <IconRefresh size={11} />
                  RETRY
                </button>
              </li>
            )}

            {!loading && !failed && filtered.length === 0 && (
              <li className="py-14 text-center text-xs tracking-[0.15em] text-zinc-500">
                {query
                  ? 'No machines match that callsign.'
                  : 'The machines await their first players.'}
              </li>
            )}

            {!loading &&
              !failed &&
              filtered.map((tool, i) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  index={i}
                  topScore={topScore}
                  hottest={tool.weekScore > 0 && tool.weekScore === maxWeekScore}
                  isYourTeam={tool.name === viewerFaction}
                  onSelect={setSelectedName}
                  setRef={setRowRef}
                />
              ))}
          </ul>
        </div>

        <p className="mt-3 text-center text-[9px] tracking-[0.3em] text-zinc-600">
          {activeWindow === 'season'
            ? 'RANKED BY EVERY PLAYER’S COMBINED CURRENT-SEASON SCORE'
            : 'RANKED BY EVERY PLAYER’S COMBINED LIFETIME SCORE'}
        </p>
        <p className="mt-1 text-center text-[9px] tracking-[0.22em] text-zinc-700">
          BURN = OPT-IN AGENT ESTIMATES · NEVER RANKS A MACHINE
        </p>

        {/* ---------- sticky YOUR TEAM / recruit bar ---------- */}
        {!loading && !failed && tools !== null && viewerFaction !== undefined && (
          <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mt-4">
            {yourRow ? (
              <YourFactionBar tool={yourRow} onJump={jumpToYourTeam} />
            ) : (
              <RecruitBar />
            )}
          </div>
        )}
      </section>

      {selectedTool && tools && (
        <ToolCard
          tool={selectedTool}
          tools={tools}
          windowLabel={activeWindow === 'season' ? 'SEASON' : 'ALL-TIME'}
          isYourTeam={selectedTool.name === viewerFaction}
          onClose={() => setSelectedName(null)}
        />
      )}

      <style jsx global>{`
        .lbai-hue {
          --tb: var(--tb-d);
        }
        html.light .lbai-hue {
          --tb: var(--tb-i);
        }

        .lbai-reveal {
          animation: lbai-reveal-in 640ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rv, 0ms);
        }
        @keyframes lbai-reveal-in {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
        }
        .lbai-row-in {
          animation: lbai-row-enter 480ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          animation-delay: var(--rd, 0ms);
        }
        @keyframes lbai-row-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
        }

        /* jersey rows — the hover/focus wash and rail wear the house hue */
        .lbai-rowbtn {
          cursor: pointer;
          transition: background-color 200ms ease;
        }
        .lbai-rowbtn:hover,
        .lbai-rowbtn:focus-visible {
          background: rgb(var(--tb-d) / 0.06);
          box-shadow: inset 2px 0 0 rgb(var(--tb));
        }
        .lbai-rowbtn:focus-visible {
          outline: 2px solid rgb(var(--tb) / 0.6);
          outline-offset: -2px;
        }
        /* your-team row rests tinted; hover lifts it a step */
        .lbai-yours .lbai-rowbtn {
          background: rgb(var(--tb-d) / 0.05);
          box-shadow: inset 2px 0 0 rgb(var(--tb));
        }
        .lbai-yours .lbai-rowbtn:hover,
        .lbai-yours .lbai-rowbtn:focus-visible {
          background: rgb(var(--tb-d) / 0.1);
        }

        /* pause the podium's infinite FX while the ToolCard covers them */
        .lbai-freeze * {
          animation-play-state: paused !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .lbai-reveal,
          .lbai-row-in {
            animation: none;
          }
          .lbai-rowbtn {
            transition: none;
          }
        }
      `}</style>
    </>
  )
}

/* ================= stat strip cell ================= */

function StatCell({
  divider,
  icon,
  label,
  hint,
  valueStyle,
  children
}: {
  divider: number
  icon: React.ReactNode
  label: string
  hint?: string
  valueStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  const divCls = (() => {
    if (divider === 0) return ''
    if (divider === 1) return 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]'
    if (divider === 2)
      return 'border-t border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0 md:border-l'
    return 'border-t border-l border-[rgb(var(--lb-panel-edge)/0.08)] md:border-t-0'
  })()

  return (
    <div className={`flex min-w-0 flex-col items-center overflow-hidden px-4 py-4 text-center ${divCls}`}>
      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[9px] tracking-[0.16em] sm:tracking-[0.28em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className="mt-2.5 max-w-full text-[clamp(11px,2.6vw,16px)] text-zinc-50 tabular-nums [font-family:var(--font-pixel)]"
        style={valueStyle}
      >
        {children}
      </div>
      {hint && (
        <div className="mt-1 max-w-full truncate text-[9px] tracking-[0.2em] text-zinc-600">{hint}</div>
      )}
    </div>
  )
}

/* ================= burn read-out ================= */

/** Same USD markup the Burn Board uses: optional "<" for sub-cent
 *  values, green dollar mark, exact-decimal display parts. */
function BurnValue({ value }: { value: string }) {
  const display = usdDisplayParts(value)
  return (
    <>
      {display.tiny ? '<' : null}
      <span className="text-[#39ff88]">$</span>
      {display.number}
    </>
  )
}

/* ================= standings rows ================= */

function ToolRow({
  tool,
  index,
  topScore,
  hottest,
  isYourTeam,
  onSelect,
  setRef
}: {
  tool: AiToolRow
  index: number
  topScore: number
  hottest: boolean
  isYourTeam: boolean
  onSelect: (name: string) => void
  setRef: (name: string, el: HTMLLIElement | null) => void
}) {
  const medal = medalFor(tool.rank)
  const identity = identityForTool(tool.name)
  const pct = topScore > 0 ? Math.max(2, Math.round((tool.score / topScore) * 100)) : 0

  return (
    <li
      ref={(el) => setRef(tool.name, el)}
      className={`lbai-row-in lbai-hue border-b border-[rgb(var(--lb-panel-edge)/0.05)] last:border-b-0 ${
        isYourTeam ? 'lbai-yours' : ''
      }`}
      style={{
        ...hueVars(identity.rgb),
        ['--rd' as string]: `${Math.min(index, 12) * 34}ms`
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(tool.name)}
        aria-label={`Open faction card — ${tool.name}, rank ${tool.rank}`}
        className={`${ROW_GRID} lbai-rowbtn w-full py-4 text-left focus-visible:outline-none`}
      >
        {/* rank — medal chrome on the podium, quiet brand box below it */}
        <div className="flex items-center">
          {medal ? (
            <span
              className="inline-flex h-8 w-8 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
              style={{
                color: medal.fg,
                border: `1px solid ${medalA(medal.rgb, 0.5)}`,
                background: medalA(medal.rgb, 0.08),
                textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.55)}`
              }}
            >
              {tool.rank}
            </span>
          ) : (
            <span
              className="inline-flex h-8 w-8 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]"
              style={{
                border: '1px solid rgb(var(--tb) / 0.15)',
                background: 'rgb(var(--tb-d) / 0.04)'
              }}
            >
              {tool.rank}
            </span>
          )}
        </div>

        {/* house identity — square crest, name, epithet */}
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              color: 'rgb(var(--tb))',
              background: 'rgb(var(--tb-d) / 0.08)',
              border: '1px solid rgb(var(--tb) / 0.3)'
            }}
          >
            <ToolIcon name={tool.name} size={17} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="truncate font-display text-[13px] font-medium tracking-tight"
                style={{ color: 'rgb(var(--z100))' }}
              >
                {tool.name}
              </span>
              <span
                className="shrink-0 text-[9px] tabular-nums"
                style={{ color: 'rgb(var(--tb) / 0.85)' }}
              >
                {tool.percent}%
              </span>
              {hottest && (
                <span
                  className="shrink-0"
                  style={{ color: 'rgb(var(--lb-delta))' }}
                  title="Biggest 7-day gain on the board"
                >
                  <IconFlame size={10} />
                </span>
              )}
              {isYourTeam && (
                <span
                  className="shrink-0 border px-1 py-px text-[7px] tracking-[0.2em]"
                  style={{
                    color: 'rgb(var(--tb))',
                    borderColor: 'rgb(var(--tb) / 0.4)',
                    background: 'rgb(var(--tb-d) / 0.08)'
                  }}
                >
                  YOUR TEAM
                </span>
              )}
            </span>
            <span
              className="hidden truncate text-[7px] font-semibold tracking-[0.3em] sm:block"
              style={{ color: 'rgb(var(--tb) / 0.8)' }}
            >
              {identity.epithet}
            </span>
          </span>
        </div>

        {/* pilots */}
        <div className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block">
          {formatNumber(tool.pilots)}
        </div>

        {/* verified active time */}
        <div className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block">
          {tool.active_ms > 0 ? formatDuration(tool.active_ms) : <span className="text-zinc-700">·</span>}
        </div>

        {/* 7d gain */}
        <div className="hidden text-right text-[11px] tabular-nums md:block">
          {tool.weekScore > 0 ? (
            <span style={{ color: 'rgb(var(--lb-up))' }}>+{formatCompact(tool.weekScore)}</span>
          ) : (
            <span className="text-zinc-700">·</span>
          )}
        </div>

        {/* opt-in USD burn — display-only, never a rank input */}
        <div
          className="hidden text-right text-[11px] tabular-nums text-zinc-400 md:block"
          title="Estimated agent spend from opted-in players — display only"
        >
          {tool.burnUsd !== '0' ? (
            <BurnValue value={tool.burnUsd} />
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </div>

        {/* SCORE — the main thing */}
        <div className="text-right">
          <div
            className="text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
            style={{
              color: 'rgb(var(--lb-score))',
              textShadow: medal
                ? '0 0 12px rgb(var(--lb-score) / calc(0.4 * var(--lb-glow, 1)))'
                : '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
            }}
          >
            {formatScore(tool.score)}
          </div>
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
            <div
              className="ml-auto h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: medal
                  ? `linear-gradient(90deg, ${medalA(medal.rgb, 0.4)}, ${medal.fg})`
                  : 'linear-gradient(90deg, rgb(var(--tb) / 0.35), rgb(var(--tb) / 0.9))'
              }}
            />
          </div>
        </div>
      </button>
    </li>
  )
}

function SkeletonRow({ index }: { index: number }) {
  return (
    <li
      className="lbai-row-in border-b border-[rgb(var(--lb-panel-edge)/0.05)]"
      style={{ ['--rd' as string]: `${index * 50}ms` }}
    >
      {/* mirrors the live row geometry (py-4 + h-10 crest + two-line
          identity) so the table doesn't jump; shimmer blocks ride the
          panel-edge ink so they read on the white panel too */}
      <div className={`${ROW_GRID} animate-pulse py-4`}>
        <span className="h-8 w-8 bg-[rgb(var(--lb-panel-edge)/0.05)]" />
        <span className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-[rgb(var(--lb-panel-edge)/0.05)]" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3 w-28 rounded bg-[rgb(var(--lb-panel-edge)/0.05)]" />
            <span className="hidden h-2 w-16 rounded bg-[rgb(var(--lb-panel-edge)/0.04)] sm:block" />
          </span>
        </span>
        <span className="hidden h-3 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-10 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="hidden h-3 w-12 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.04)] md:block" />
        <span className="h-3.5 w-20 justify-self-end rounded bg-[rgb(var(--lb-panel-edge)/0.06)]" />
      </div>
    </li>
  )
}

/* ================= sticky YOUR TEAM bar ================= */

/** Docked strip of the viewer's faction row — brand wash and rail in
 *  the tool's own hue, so ChatGPT mains see teal and Claude mains see
 *  orange. Click scrolls the row into view and opens the ToolCard. */
function YourFactionBar({ tool, onJump }: { tool: AiToolRow; onJump: () => void }) {
  const medal = medalFor(tool.rank)
  const identity = identityForTool(tool.name)

  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Open your faction card — ${tool.name}, rank ${tool.rank}`}
      // blur-md, same budget note as the pilots' YouBar: this sticky bar
      // re-samples whatever scrolls under it every frame.
      className="lbai-hue block w-full text-left backdrop-blur-md"
      style={{
        ...hueVars(identity.rgb),
        background: `linear-gradient(0deg, rgb(var(--tb-d) / 0.05), rgb(var(--tb-d) / 0.05)), rgb(var(--lb-panel-bg) / 0.88)`,
        border: '1px solid rgb(var(--tb) / 0.25)',
        boxShadow: 'inset 2px 0 0 rgb(var(--tb)), 0 16px 36px -20px rgb(0 0 0 / 0.5)'
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
        {medal ? (
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] [font-family:var(--font-pixel)]"
            style={{
              color: medal.fg,
              border: `1px solid ${medalA(medal.rgb, 0.5)}`,
              background: medalA(medal.rgb, 0.08),
              textShadow: `0 0 10px ${medalGlow(medal.rgb, 0.55)}`
            }}
          >
            {tool.rank}
          </span>
        ) : (
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]"
            style={{
              border: '1px solid rgb(var(--tb) / 0.2)',
              background: 'rgb(var(--tb-d) / 0.05)'
            }}
          >
            {tool.rank}
          </span>
        )}

        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: 'rgb(var(--tb))',
            background: 'rgb(var(--tb-d) / 0.08)',
            border: '1px solid rgb(var(--tb) / 0.3)'
          }}
        >
          <ToolIcon name={tool.name} size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate font-display text-[13px] font-medium tracking-tight"
              style={{ color: 'rgb(var(--tb))' }}
            >
              {tool.name}
            </span>
            <span
              className="shrink-0 border px-1.5 py-[3px] text-[8px] leading-none tracking-[0.2em]"
              style={{
                color: 'rgb(var(--tb))',
                borderColor: 'rgb(var(--tb) / 0.4)',
                background: 'rgb(var(--tb-d) / 0.08)'
              }}
            >
              YOUR TEAM
            </span>
          </div>
          <div
            className="mt-1 hidden truncate text-[7px] font-semibold tracking-[0.3em] sm:block"
            style={{ color: 'rgb(var(--tb) / 0.8)' }}
          >
            {identity.epithet}
          </div>
        </div>

        <span
          className="shrink-0 text-[15px] leading-none tabular-nums [font-family:var(--font-pixel)]"
          style={{
            color: 'rgb(var(--lb-score))',
            textShadow: '0 0 10px rgb(var(--lb-score) / calc(0.22 * var(--lb-glow, 1)))'
          }}
        >
          {formatScore(tool.score)}
        </span>
      </div>
    </button>
  )
}

/* ================= sticky recruit bar ================= */

/** The docked slot for signed-in viewers with no faction yet — quiet
 *  gold, no CTA: the seat fills itself once they play. */
function RecruitBar() {
  return (
    <div
      className="w-full backdrop-blur-md"
      style={{
        background:
          'linear-gradient(0deg, rgb(var(--lb-gold) / 0.05), rgb(var(--lb-gold) / 0.05)), rgb(var(--lb-panel-bg) / 0.88)',
        border: '1px solid rgb(var(--lb-gold) / 0.2)',
        boxShadow: 'inset 2px 0 0 rgb(var(--lb-gold)), 0 16px 36px -20px rgb(0 0 0 / 0.5)'
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5">
        <IconSwords size={16} className="shrink-0 text-[rgb(var(--lb-gold))]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[9px] leading-4 tracking-[0.18em] text-zinc-400">
            YOUR MOST-USED AI IS YOUR TEAM
          </p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-600">
            Keep playing. The machine you live in will take this seat.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ================= search ================= */

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="lb-inset flex w-full sm:max-w-xs items-center overflow-hidden rounded-lg">
      <span className="pl-3 pr-1 text-zinc-600">
        <IconSearch size={12} />
      </span>
      <input
        type="text"
        placeholder="hunt a machine…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent px-2 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="border-l border-[rgb(var(--lb-panel-edge)/0.08)] px-3 py-2 text-[10px] tracking-[0.2em] text-zinc-500 hover:text-zinc-200"
        >
          CLEAR
        </button>
      )}
    </div>
  )
}

/* ================= freshness stamp ================= */

/** Self-ticking "updated Xm ago" so only this leaf re-renders. The board
 *  is a 5-minute server cache, so a 30s tick is plenty. */
function UpdatedStamp({ generatedAt }: { generatedAt: string | null }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!generatedAt) return
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [generatedAt])

  const label = (() => {
    if (!generatedAt) return 'connecting'
    const mins = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 60_000)
    return mins <= 0 ? 'updated just now' : `updated ${mins}m ago`
  })()

  return (
    <span
      className="text-[10px] tracking-[0.2em] text-zinc-600 tabular-nums"
      suppressHydrationWarning
    >
      {label}
      <span className="mx-2 text-zinc-800">·</span>
      refreshes every 5 min
    </span>
  )
}
