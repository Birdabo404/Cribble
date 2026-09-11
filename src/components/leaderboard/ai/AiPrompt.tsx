'use client'

// The list's heading, the way the drinks menu heads its list with
// `agibar@bj:~$ cat drinks.menu`: one prompt line — `cribble@arena:~$
// rank --window=… --sort=… --top=25` — which is the board's state
// written back as the command that would produce it. The tail re-types
// (anime splitText, stepped) when a control changes; the orange block
// cursor pulses after it. This is the board's one terminal gesture.
//
// Beneath, on two calm lines: the window toggles with the filter field
// and the result count on the right; then the category chips.

import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  commandTail,
  type AiCategoryFilter,
  type AiSortDir,
  type AiSortKey,
  type AiWindowId
} from '@/components/leaderboard/ai/aiBoardState'
import {
  blinkCursor,
  runLoop,
  typewriter
} from '@/components/leaderboard/ai/aiMotion'
import { AI_CATEGORY_LABEL, type AiToolCategory } from '@/lib/aiToolOrgs'

const WINDOWS: { id: AiWindowId; label: string }[] = [
  { id: 'season', label: 'SEASON' },
  { id: 'alltime', label: 'ALL-TIME' }
]

export type AiPromptProps = {
  window: AiWindowId
  /** False during intermission — the window toggles disappear. */
  hasSeason: boolean
  onWindow: (window: AiWindowId) => void
  sort: AiSortKey
  sortDir: AiSortDir
  category: AiCategoryFilter
  /** Categories present in the active window's tools, in AI_CATEGORY_ORDER. */
  categories: readonly AiToolCategory[]
  onCategory: (category: AiCategoryFilter) => void
  query: string
  onQuery: (query: string) => void
  /** Rows on screen / rows that matched before the top-N cut. */
  shown: number
  matched: number
}

export function AiPrompt({
  window,
  hasSeason,
  onWindow,
  sort,
  sortDir,
  category,
  categories,
  onCategory,
  query,
  onQuery,
  shown,
  matched
}: AiPromptProps) {
  const tail = commandTail({ window, sort, dir: sortDir, category, query })

  // Keyed by the tail so React hands the typewriter a fresh element each
  // change; the previous split reverts on a node that is already gone.
  // Layout effect: the split and the hidden first frame land before the
  // full tail can paint.
  const tailRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = tailRef.current
    if (!el) return
    return runLoop(typewriter(el))
  }, [tail])

  const cursorRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = cursorRef.current
    if (!el) return
    return runLoop(blinkCursor(el))
  }, [])

  return (
    <div className="aib-prompt">
      {/* The host folds away on phones — `$ rank …` keeps the line whole. */}
      <p className="aib-prompt-line">
        <span className="aib-prompt-user">
          <span className="aib-prompt-host">cribble@arena:~</span>$
        </span>{' '}
        <span className="aib-prompt-cmd">rank</span>{' '}
        <span key={tail} ref={tailRef} className="aib-prompt-tail">
          {tail}
        </span>
        <span ref={cursorRef} className="aib-cursor" aria-hidden />
      </p>

      {/* One row on desktop: bracketed toggles, the filter box, the count.
          On phones the same DOM becomes a deck of equal-height framed
          rows — a segmented window switch, a full-width filter with the
          count inside it — see .aib-controls-row under 768. */}
      <div className="aib-controls">
        <div className="aib-controls-row">
          {hasSeason && (
            <div className="aib-toggles" role="tablist" aria-label="Ranking window">
              {WINDOWS.map((item) => {
                const active = window === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className="aib-toggle"
                    onClick={() => onWindow(item.id)}
                  >
                    <span className="aib-toggle-bracket" aria-hidden>
                      [{' '}
                    </span>
                    {item.label}
                    <span className="aib-toggle-bracket" aria-hidden>
                      {' '}]
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="aib-filter-row">
            <label className="aib-filter">
              <span className="aib-filter-mark" aria-hidden>
                /
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="filter"
                aria-label="Filter machines by name or organization"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <output className="aib-count" aria-live="polite">
              {shown === matched ? `${shown} SHOWN` : `TOP ${shown} OF ${matched}`}
            </output>
          </div>
        </div>

        <div className="aib-chips" role="group" aria-label="Category">
          <button
            type="button"
            className="aib-chip"
            aria-pressed={category === 'all'}
            onClick={() => onCategory('all')}
          >
            ALL
          </button>
          {categories.map((id) => (
            <button
              key={id}
              type="button"
              className="aib-chip"
              aria-pressed={category === id}
              onClick={() => onCategory(id)}
            >
              {AI_CATEGORY_LABEL[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
