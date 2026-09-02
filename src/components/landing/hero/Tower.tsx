'use client'

// Hero tower — the board at rest: SIM_ROSTER's top six as a real table,
// then a dashed empty row that is the pitch. The root carries
// data-hero-enter but never lx-hero-exit: the pin staggers [data-hero-row]
// itself, and the header cells leave with the rail/footer cells
// (data-hero-cell on each <th> — the exits tween cells, never row groups,
// so no column label can linger over the empty frame). Row hairlines are
// per-cell top borders (the first row skips its own so it never doubles
// the header's [data-hero-line]). Separate borders with zero spacing, not
// collapsed: collapsed borders belong to the table's grid and ignore a
// row's opacity, so they would pop in whole while the entrance is still
// fading the rows. The wrapper in HomeV2 fades the whole table
// (.lx-hero-exit) right behind the row stagger, so no cell border can
// outlive its row mid-pin either. The SSR'd cells are the
// liveness ticker's targets (useTowerLiveness.ts) — DOM writes only, so
// this component never re-renders after hydration. Cell/column classes
// live in towerStyles.ts so the descent's Arena board draws the same table.

import Link from 'next/link'
import { useRef } from 'react'
import { SIM_ROSTER } from '@/components/landing/data'
import { formatGap, formatScore } from './towerFormat'
import {
  COL_CALLSIGN,
  COL_GAP,
  COL_ORG,
  COL_POS,
  COL_SCORE,
  LINE,
  TD,
  TH,
  YOU_LINE
} from './towerStyles'
import { useTowerLiveness } from './useTowerLiveness'

const ROWS = SIM_ROSTER.slice(0, 6)

export function Tower() {
  const tableRef = useRef<HTMLTableElement>(null)
  useTowerLiveness(tableRef)

  return (
    <table
      ref={tableRef}
      data-hero-enter
      className="w-full border-separate border-spacing-0 font-data text-[12px] tabular-nums"
    >
      <caption className="sr-only">Global standings, season 01</caption>
      <thead>
        {/* position: relative on the row is what lets the hairline span
            the full width from inside the first cell */}
        <tr className="relative">
          <th scope="col" data-hero-cell className={`${TH} ${COL_POS}`}>
            P
            <span
              aria-hidden
              data-hero-line
              className="absolute inset-x-0 bottom-0 h-px"
              style={{
                background: 'var(--lx-line)',
                transformOrigin: 'left center'
              }}
            />
          </th>
          <th scope="col" data-hero-cell className={`${TH} ${COL_CALLSIGN}`}>
            CALLSIGN
          </th>
          <th scope="col" data-hero-cell className={`${TH} ${COL_ORG}`}>
            ORG
          </th>
          <th scope="col" data-hero-cell className={`${TH} ${COL_SCORE}`}>
            SCORE
          </th>
          <th scope="col" data-hero-cell className={`${TH} ${COL_GAP}`}>
            GAP
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((p, i) => {
          const line = i === 0 ? '' : LINE
          return (
            <tr key={p.id} data-hero-row>
              <td
                className={`${TD} ${line} ${COL_POS} text-[color:var(--lx-ink-dim)]`}
              >
                {String(i + 1).padStart(2, '0')}
              </td>
              <td
                className={`${TD} ${line} ${COL_CALLSIGN} text-[color:var(--lx-ink)]`}
              >
                {p.callsign}
              </td>
              <td
                className={`${TD} ${line} ${COL_ORG} text-[length:var(--fs-label)] tracking-[0.18em] text-[color:var(--lx-ink-dim)]`}
              >
                {p.org}
              </td>
              <td
                className={`${TD} ${line} ${COL_SCORE} text-[color:var(--lx-ink)]`}
              >
                <data value={String(p.score)} data-hero-score data-value={p.score}>
                  {formatScore(p.score)}
                </data>
              </td>
              <td
                data-hero-gap
                className={`${TD} ${line} ${COL_GAP} text-[color:var(--lx-ink-dim)]`}
              >
                {formatGap(p.score)}
              </td>
            </tr>
          )
        })}

        {/* The pitch. One link, stretched over the row with an ::after so
            the whole slot is the target while the tab order stays one stop. */}
        <tr
          data-hero-row="you"
          className="group relative transition-colors hover:bg-[color:rgb(var(--z900)/0.55)]"
        >
          <td className={`${TD} ${YOU_LINE} ${COL_POS} text-[color:var(--lx-ink-dim)]`}>
            <span aria-hidden>··</span>
          </td>
          <td className={`${TD} ${YOU_LINE} ${COL_CALLSIGN}`}>
            <Link
              href="/login"
              aria-label="you — claim your spot"
              className="text-[color:var(--lx-ink)] transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-[color:var(--lx-signal)]"
            >
              you
            </Link>
          </td>
          <td className={`${TD} ${YOU_LINE} ${COL_ORG}`} />
          <td className={`${TD} ${YOU_LINE} ${COL_SCORE} text-[color:var(--lx-ink-faint)]`}>
            <span aria-hidden>——————</span>
          </td>
          <td
            className={`${TD} ${YOU_LINE} ${COL_GAP}`}
            style={{ color: 'var(--lx-signal)' }}
          >
            ∞
          </td>
        </tr>
      </tbody>
    </table>
  )
}
