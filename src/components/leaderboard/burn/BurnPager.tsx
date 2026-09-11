// The footer's pager — `‹ PREV  01 02 03  NEXT ›` as text buttons in the
// AI board's toggle register: no pills, no borders, the current page
// underlined in ember. Past seven pages the numbers fold to a window
// around the current one (pageItems). On phones the numbers give way to
// a `03 / 05` position so PREV / NEXT keep the width. The right side is
// the viewer's readout when they are ranked: `YOU · #40 · [ JUMP ]` while
// their row is on another page, a static `YOU · #40` once it is in view.
// Renders nothing on a one-page board with no ranked viewer.

import { padRank } from '@/components/leaderboard/ai/aiBoardState'
import { pageItems } from '@/components/leaderboard/burn/burnPaging'

export type BurnPagerYou = {
  rank: number
  /** Turn to the viewer's page and light their row up. */
  onJump: () => void
  /** The viewer's row is on the page being shown. */
  onPage: boolean
}

export type BurnPagerProps = {
  page: number
  totalPages: number
  onPage: (page: number) => void
  you?: BurnPagerYou | null
}

export function BurnPager({ page, totalPages, onPage, you = null }: BurnPagerProps) {
  if (totalPages <= 1 && !you) return null

  const atFirst = page <= 1
  const atLast = page >= totalPages

  return (
    <nav className="bb-pager" aria-label="Burn board pages">
      {totalPages > 1 && (
        <div className="bb-pager-pages">
          <button
            type="button"
            className="bb-toggle"
            disabled={atFirst}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            ‹ PREV
          </button>
          {pageItems(page, totalPages).map((item, i) =>
            item === '…' ? (
              <span key={`gap-${i}`} className="bb-pager-gap" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className="bb-toggle bb-pager-num"
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}`}
                onClick={() => onPage(item)}
              >
                {padRank(item)}
              </button>
            )
          )}
          <span className="bb-pager-pos" aria-hidden>
            {padRank(page)} / {padRank(totalPages)}
          </span>
          <button
            type="button"
            className="bb-toggle"
            disabled={atLast}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            NEXT ›
          </button>
        </div>
      )}

      {you && (
        <p className="bb-pager-you">
          <span className="bb-pager-k">YOU</span>
          <Dot />
          <span>#{you.rank}</span>
          {!you.onPage && (
            <>
              <Dot />
              <button type="button" className="bb-toggle" data-ember onClick={you.onJump}>
                [ JUMP ]
              </button>
            </>
          )}
        </p>
      )}
    </nav>
  )
}

function Dot() {
  return (
    <span className="bb-pager-dot" aria-hidden>
      ·
    </span>
  )
}
