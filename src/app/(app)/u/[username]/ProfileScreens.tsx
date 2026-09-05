'use client'

// The three non-ready states of /u/[username], on the same paper as the
// record so the swap to the real thing changes nothing but the ink:
// the loading skeleton (same two-pane anatomy at the same breakpoints —
// spine, divider, ribbon, banner, meta rows, the RECORD pane's cells,
// grid and log, the footer; from lg the TRANSMISSIONS frame — every
// row on the real line boxes, so the boot lands without a jump and the
// swap does not double the sheet's height; CSS pulse only, no GSAP
// before the data), the 404 (PILOT NOT FOUND) and the error (RECORD
// UNAVAILABLE) sheets.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Frame, PAGE_WRAP, SHEET } from './parts'

/** An unprinted mark: a paper-2 block that breathes. The pulse is per
 *  mark, never on the sheet — pulsing the sheet faded its paper and
 *  hairlines to half and let the board's grid show through. Still under
 *  reduced motion. */
const PULSE = 'bg-[color:var(--pf-paper-2)] animate-pulse motion-reduce:animate-none'
/** The pulse alone, for a wrapper whose children are all marks (the
 *  activity dots: one layer instead of ninety-one). */
const BREATHE = 'animate-pulse motion-reduce:animate-none'
/** paper-2 with no pulse of its own, for the children of a BREATHE wrapper. */
const MARK = 'bg-[color:var(--pf-paper-2)]'
const HAIRLINE = 'border-[color:var(--pf-line-soft)]'

/** A framed empty sheet with a centred message and one action row. */
function Notice({
  code,
  title,
  body,
  action
}: {
  code: string
  title: string
  body: ReactNode
  action: ReactNode
}) {
  return (
    <div className={PAGE_WRAP}>
      <div className={`${SHEET} flex flex-col items-center px-6 pb-16 pt-20 text-center`}>
        <div
          className="select-none text-4xl leading-none [font-family:var(--font-pixel)]"
          style={{ color: 'rgb(var(--pf-ink-rgb) / 0.18)' }}
        >
          {code}
        </div>
        <h1 className="pf-label mt-6">{title}</h1>
        <p className="mt-3 max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--pf-ink-2)' }}>
          {body}
        </p>
        {action}
      </div>
    </div>
  )
}

const ACTION_ROW =
  'pf-frame mt-8 inline-flex min-h-11 items-center px-5 font-data text-[10px] uppercase tracking-[0.18em] transition-colors hover:bg-[color:var(--pf-paper-3)] lg:min-h-10'

export function MissingPilot({ username }: { username: string }) {
  return (
    <Notice
      code="404"
      title="PILOT NOT FOUND"
      body={
        <>
          No record on file for <span style={{ color: 'var(--pf-ink)' }}>@{username}</span>. The
          callsign may have changed, or this pilot never enlisted.
        </>
      }
      action={
        <Link href="/leaderboard" className={ACTION_ROW} style={{ color: 'var(--pf-ink)' }}>
          SCAN THE LEADERBOARD
        </Link>
      }
    />
  )
}

export function ProfileError() {
  return (
    <Notice
      code="ERR"
      title="RECORD UNAVAILABLE"
      body="The record could not be retrieved. Give it a moment and try again."
      action={
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={ACTION_ROW}
          style={{ color: 'var(--pf-ink)' }}
        >
          RETRY
        </button>
      }
    />
  )
}

/** Six cells on StatCell's anatomy — its paddings, the label line, the
 *  numeral row, the context line — and hairlines, so the RECORD grid
 *  lands on the skeleton's own baselines. */
function CellsSkeleton() {
  return (
    <div className="overflow-hidden">
      <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`border-l border-t px-4 py-3.5 sm:py-4 md:py-5 ${HAIRLINE}`}>
            <div className="flex h-3 items-center">
              <div className={`h-2 w-14 ${PULSE}`} />
            </div>
            <div className="mt-2.5 flex h-[18px] items-end sm:h-4 md:h-[18px]">
              <div className={`h-4 w-20 ${PULSE}`} />
            </div>
            <div className="mt-2 flex h-3.5 items-center sm:h-3">
              <div className={`h-2 w-16 ${PULSE}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** ActivityGrid's box: a label line, then 13 x 7 dots on its 3px gap in
 *  column flow (8px below sm, 10px from it — the .pf-grid-dot sizes) and
 *  the 12px month-tick row under them. */
function GridSkeleton() {
  return (
    <div className="mt-6">
      <div className="flex h-3.5 items-center justify-between">
        <div className={`h-2 w-40 ${PULSE}`} />
        <div className={`h-2 w-24 ${PULSE}`} />
      </div>
      <div className={`mt-3 grid grid-flow-col grid-rows-7 justify-start gap-[3px] ${BREATHE}`}>
        {Array.from({ length: 91 }, (_, i) => (
          <div key={i} className={`h-2 w-2 sm:h-2.5 sm:w-2.5 ${MARK}`} />
        ))}
      </div>
      <div className="mt-[3px] h-3" />
    </div>
  )
}

/** SystemLog's box: a label line and three of its rows (py-2, an 11px
 *  mono line, a hairline under each). */
function LogSkeleton() {
  return (
    <div className="mt-6">
      <div className="flex h-3.5 items-center justify-between">
        <div className={`h-2 w-20 ${PULSE}`} />
        <div className={`h-2 w-12 ${PULSE}`} />
      </div>
      <div className={`mt-3 border-t ${HAIRLINE}`}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={`flex h-[33.5px] items-center gap-3 border-b ${HAIRLINE}`}>
            <div className={`h-1.5 w-1.5 ${PULSE}`} />
            <div className={`h-2 w-20 ${PULSE}`} />
            <div className={`h-2 w-48 max-w-[50%] ${PULSE}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The spine's TRANSMISSIONS frame, lg only, on that panel's own
 *  skeleton anatomy (a py-2 header, eight 48px rows with a hairline
 *  between) so the spine is as tall before the payload as after it. */
function TransmissionsSkeleton() {
  return (
    <Frame className="hidden lg:mx-[var(--pf-gutter)] lg:mb-[var(--pf-gutter)] lg:block">
      <div className="flex h-[29px] items-center gap-3 px-[var(--pf-inset)]">
        <div className={`h-2 w-28 ${PULSE}`} />
        <div className="h-px min-w-3 flex-1 bg-[color:var(--pf-line-soft)]" />
        <div className={`h-2 w-6 ${PULSE}`} />
      </div>
      <div className="divide-y divide-[color:var(--pf-line-soft)]">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-3 px-[var(--pf-inset)]">
            <div className={`h-5 w-5 shrink-0 ${PULSE}`} />
            <div className="flex flex-1 flex-col justify-center gap-2.5">
              <div className={`h-2 w-24 ${PULSE}`} />
              <div className={`h-1.5 w-32 ${PULSE}`} />
            </div>
            <div className={`h-1.5 w-4 ${PULSE}`} />
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function ProfileSkeleton() {
  return (
    <div className={PAGE_WRAP}>
      {/* the sheet itself stays opaque paper: no pulse here (see PULSE);
          aria-busy names the state instead of a class */}
      <div aria-busy="true" className={`${SHEET} lg:grid lg:grid-cols-[296px_1px_1fr]`}>
        {/* spine (hero below lg) — the identity mirrors Spine exactly:
            the 96px avatar pulled up by half over the banner; from lg the
            same 1px --pf-line frame inset by --pf-inset, the avatar a
            full-width square inside it with the ticks' 6px margin (218px
            in the 296px spine). The name / handle / designation bars sit
            in rows the height of the real line boxes on each tier (22px
            and 26px leading-tight; 13px and 12px at 1.5; .pf-micro) and
            a 16px row stands in for the stamps + presence line, so the
            first action lands where its bar was on both. */}
        <div className="lg:self-start">
          <div className={`h-[140px] ${PULSE} lg:hidden`} />
          <div className="px-[var(--pf-gutter)] pb-5 lg:pt-6">
            <div className="lg:border lg:border-[color:var(--pf-line)] lg:p-[var(--pf-inset)]">
              <div className={`-mt-12 h-24 w-24 ${PULSE} lg:m-1.5 lg:aspect-square lg:h-auto lg:w-auto`} />
              <div className="mt-4 flex h-[27.5px] items-center lg:h-[32.5px]">
                <div className={`h-6 w-44 ${PULSE}`} />
              </div>
              <div className="mt-1 flex h-[19.5px] items-center lg:h-[18px]">
                <div className={`h-3 w-28 ${PULSE}`} />
              </div>
              <div className="mt-2 flex h-3 items-center">
                <div className={`h-2.5 w-36 ${PULSE}`} />
              </div>
            </div>
            <div className="mt-3 flex h-4 items-center justify-between">
              <div className={`h-2 w-24 ${PULSE}`} />
              <div className={`h-2 w-20 ${PULSE}`} />
            </div>
            <div className="mt-5 space-y-2">
              <div className={`h-11 ${PULSE} lg:h-10`} />
              <div className={`h-11 border lg:h-10 ${HAIRLINE}`} />
            </div>
          </div>
          {/* the menu: the phone strip's ruled row, the spine's framed
              list from lg (ProfileClient's lg:border, margins) */}
          <div
            className={`flex h-11 items-center gap-6 border-y px-[var(--pf-gutter)] lg:mx-[var(--pf-gutter)] lg:mb-[var(--pf-gutter)] lg:h-auto lg:flex-col lg:items-stretch lg:gap-0 lg:border lg:border-[color:var(--pf-line)] lg:px-[var(--pf-inset)] ${HAIRLINE}`}
          >
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-3">
                <div className={`h-1.5 w-1.5 ${PULSE}`} />
                <div className={`h-2 w-16 ${PULSE}`} />
              </div>
            ))}
          </div>
          <TransmissionsSkeleton />
        </div>

        <div aria-hidden className="hidden w-px self-stretch bg-[color:var(--pf-line-soft)] lg:block" />

        {/* content — a flex column from lg like the real one, so the
            footer sits on the bottom edge under a taller spine */}
        <div className="min-w-0 px-[var(--pf-gutter)] pb-6 pt-[var(--pf-gutter)] lg:flex lg:flex-col">
          <Frame className="flex h-9 items-center justify-between px-[var(--pf-inset)]">
            <div className={`h-2 w-32 ${PULSE}`} />
            <div className={`hidden h-2 w-40 sm:block ${PULSE}`} />
          </Frame>
          <div className={`mt-4 hidden h-[176px] lg:block ${PULSE}`} />
          <div className="mt-5 space-y-3">
            <div className={`h-3.5 w-full max-w-xl ${PULSE}`} />
            <div className={`h-3.5 w-3/4 max-w-md ${PULSE}`} />
          </div>
          <div className={`mt-5 border-t ${HAIRLINE}`}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={`flex items-center gap-4 border-b py-3 ${HAIRLINE}`}>
                <div className={`h-2 w-20 ${PULSE}`} />
                <div className={`h-2.5 w-40 ${PULSE}`} />
              </div>
            ))}
          </div>
          {/* the counts row (44px targets on phones, a line from sm) */}
          <div className="mt-4 flex h-11 items-center gap-5 sm:h-5">
            <div className={`h-3 w-24 ${PULSE}`} />
            <div className={`h-3 w-24 ${PULSE}`} />
          </div>

          {/* the pane frame on the RECORD pane's anatomy: PanelHeader at
              the inset, then the pane body's py-5 around cells, grid, log */}
          <Frame className="mt-6 lg:mb-5">
            <div className="px-[var(--pf-gutter)] pt-[var(--pf-inset)]">
              <div className="flex h-3.5 items-center gap-3">
                <div className="h-px flex-1 bg-[color:var(--pf-line-soft)]" />
                <div className={`h-2 w-16 ${PULSE}`} />
                <div className="h-px flex-1 bg-[color:var(--pf-line-soft)]" />
              </div>
            </div>
            <div className="px-[var(--pf-gutter)] py-5">
              <CellsSkeleton />
              <GridSkeleton />
              <LogSkeleton />
            </div>
          </Frame>

          <div className={`mt-5 flex h-[25px] items-center justify-between gap-3 border-t pt-3 ${HAIRLINE} lg:mt-auto`}>
            <div className={`h-2 w-44 ${PULSE}`} />
            <div className={`h-2 w-20 ${PULSE}`} />
          </div>
        </div>
      </div>
    </div>
  )
}
