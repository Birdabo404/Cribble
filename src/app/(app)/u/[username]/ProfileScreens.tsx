'use client'

// The three non-ready states of /u/[username], on the same paper as the
// record so the swap to the real thing changes nothing but the ink:
// the loading skeleton (same two-pane anatomy at the same breakpoints —
// spine, divider, ribbon, banner, meta rows, six cells — so the boot
// lands without a jump; CSS pulse only, no GSAP before the data), the
// 404 (PILOT NOT FOUND) and the error (RECORD UNAVAILABLE) sheets.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Frame, PAGE_WRAP, SHEET } from './parts'

const PULSE = 'bg-[color:var(--pf-paper-2)]'

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

/** Six grey cells in the RECORD grid's hairline recipe. */
function CellsSkeleton() {
  return (
    <div className="overflow-hidden">
      <div className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border-l border-t border-[color:var(--pf-line-soft)] px-4 py-4">
            <div className={`h-2 w-14 ${PULSE}`} />
            <div className={`mt-4 h-4 w-20 ${PULSE}`} />
            <div className={`mt-3 h-2 w-16 ${PULSE}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className={PAGE_WRAP}>
      <div className={`${SHEET} animate-pulse lg:grid lg:grid-cols-[296px_1px_1fr]`}>
        {/* spine (hero below lg) — the identity mirrors Spine exactly:
            the 96px avatar pulled up by half over the banner; from lg the
            same 1px --pf-line frame inset by --pf-inset, the avatar a
            full-width square inside it with the ticks' 6px margin (218px
            in the 296px spine). From lg the name / handle / designation
            bars sit in rows the height of the real line boxes (26px
            leading-tight, 12px at 1.5, .pf-micro) and a presence row
            stands in for the stamps line, so FOLLOW lands where the
            first action bar was. */}
        <div className="lg:self-start">
          <div className={`h-[140px] ${PULSE} lg:hidden`} />
          <div className="px-[var(--pf-gutter)] pb-5 lg:pt-6">
            <div className="lg:border lg:border-[color:var(--pf-line)] lg:p-[var(--pf-inset)]">
              <div className={`-mt-12 h-24 w-24 ${PULSE} lg:m-1.5 lg:aspect-square lg:h-auto lg:w-auto`} />
              <div className="mt-4 flex h-6 items-center lg:h-[32.5px]">
                <div className={`h-6 w-44 ${PULSE}`} />
              </div>
              <div className="mt-2 flex h-3 items-center lg:mt-1 lg:h-[18px]">
                <div className={`h-3 w-28 ${PULSE}`} />
              </div>
              <div className="mt-2 flex h-2.5 items-center lg:h-3">
                <div className={`h-2.5 w-36 ${PULSE}`} />
              </div>
            </div>
            <div className="hidden lg:mt-3 lg:flex lg:h-4 lg:items-center lg:justify-end">
              <div className={`h-2 w-20 ${PULSE}`} />
            </div>
            <div className="mt-5 space-y-2">
              <div className={`h-11 ${PULSE} lg:h-10`} />
              <div className="h-11 border border-[color:var(--pf-line-soft)] lg:h-10" />
            </div>
          </div>
          <div className="flex h-11 items-center gap-6 border-y border-[color:var(--pf-line-soft)] px-[var(--pf-gutter)] lg:h-auto lg:flex-col lg:items-stretch lg:gap-0 lg:border-y-0">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-3">
                <div className={`h-1.5 w-1.5 ${PULSE}`} />
                <div className={`h-2 w-16 ${PULSE}`} />
              </div>
            ))}
          </div>
        </div>

        <div aria-hidden className="hidden w-px self-stretch bg-[color:var(--pf-line-soft)] lg:block" />

        {/* content */}
        <div className="min-w-0 px-[var(--pf-gutter)] pb-6 pt-[var(--pf-gutter)]">
          <Frame className="flex h-9 items-center justify-between px-[var(--pf-inset)]">
            <div className={`h-2 w-32 ${PULSE}`} />
            <div className={`hidden h-2 w-40 sm:block ${PULSE}`} />
          </Frame>
          <div className={`mt-4 hidden h-[176px] lg:block ${PULSE}`} />
          <div className="mt-5 space-y-3">
            <div className={`h-3.5 w-full max-w-xl ${PULSE}`} />
            <div className={`h-3.5 w-3/4 max-w-md ${PULSE}`} />
          </div>
          <div className="mt-5 border-t border-[color:var(--pf-line-soft)]">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-[color:var(--pf-line-soft)] py-3">
                <div className={`h-2 w-20 ${PULSE}`} />
                <div className={`h-2.5 w-40 ${PULSE}`} />
              </div>
            ))}
          </div>
          <Frame className="mt-6">
            <div className="flex h-10 items-center gap-3 px-[var(--pf-gutter)]">
              <div className="h-px flex-1 bg-[color:var(--pf-line-soft)]" />
              <div className={`h-2 w-16 ${PULSE}`} />
              <div className="h-px flex-1 bg-[color:var(--pf-line-soft)]" />
            </div>
            <div className="px-[var(--pf-gutter)] pb-5">
              <CellsSkeleton />
            </div>
          </Frame>
        </div>
      </div>
    </div>
  )
}
