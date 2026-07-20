'use client'

import { useMemo } from 'react'
import { ACCENT, accentA } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import { AccentGlow, Panel } from './Panel'
import type { ActivityDay } from '@/types/dashboard'

function last7Days(activity: ActivityDay[]) {
  const byDate = new Map(activity.map((d) => [d.date, d.score]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out: { key: string; label: string; active: boolean; isToday: boolean }[] = []
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().split('T')[0]
    out.push({
      key,
      label: dayLetters[d.getDay()],
      active: (byDate.get(key) || 0) > 0,
      isToday: i === 0
    })
  }
  return out
}

/**
 * Right rail beside the hero: season countdown + progress on top,
 * current streak with a 7-day tracker below. During an intermission the
 * dashboard passes name="INTERMISSION" and the countdown targets the next
 * season's launch instead of the current season's lock.
 */
export function SeasonRail({
  name,
  pct,
  daysLeft,
  daysLabel,
  streak,
  activity
}: {
  name: string
  pct: number
  daysLeft: number
  daysLabel: string
  streak: number
  activity: ActivityDay[]
}) {
  const week = useMemo(() => last7Days(activity), [activity])

  return (
    <div className="col-span-12 lg:col-span-4 grid grid-rows-2 gap-5">
      <Panel className="p-6 flex flex-col justify-between">
        <AccentGlow className="-top-20 -right-16 h-44 w-44 opacity-20" />
        <div className="relative">
          <div className="anim-fade flex items-baseline justify-between" style={animDelay(80)}>
            <div className="text-[10px] tracking-[0.4em] text-zinc-300">{name}</div>
            <div className="text-[10px] tracking-[0.3em]" style={{ color: ACCENT }}>
              {pct}%
            </div>
          </div>
          <div
            className="anim-rise mt-2 text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums"
            style={animDelay(160)}
          >
            {daysLeft}
            <span className="text-zinc-500 text-base font-normal tracking-[0.2em]"> {daysLabel}</span>
          </div>
        </div>
        <div className="relative mt-4">
          <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
            <div
              className="anim-grow-x h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: ACCENT,
                boxShadow: `0 0 8px ${accentA(0.6)}`,
                ...animDelay(300)
              }}
            />
          </div>
        </div>
      </Panel>

      <Panel className="p-6 flex flex-col justify-between">
        <div className="relative">
          <div className="anim-fade text-[10px] tracking-[0.4em] text-zinc-300" style={animDelay(140)}>
            STREAK
          </div>
          <div
            className="anim-rise mt-2 text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums"
            style={animDelay(220)}
          >
            {streak}
            <span className="text-zinc-500 text-base font-normal tracking-[0.2em]"> DAYS</span>
          </div>
        </div>
        <div className="relative mt-4">
          <div className="flex items-center justify-between gap-1.5">
            {week.map((d, i) => (
              <div
                key={d.key}
                className="anim-cell flex flex-col items-center gap-1.5 flex-1"
                style={animDelay(300 + i * 40)}
              >
                {/* Active dots pop in dark, then ignite one by one after the row lands */}
                <div
                  className={`h-2 w-full max-w-[26px] rounded-full transition-colors ${
                    d.active
                      ? 'anim-ignite bg-accent shadow-[0_0_6px_rgb(var(--accent-rgb)/0.5)]'
                      : 'bg-zinc-900'
                  } ${d.isToday && !d.active ? 'ring-1 ring-accent/40' : ''}`}
                  style={d.active ? animDelay(700 + i * 130) : undefined}
                  title={`${d.key}${d.active ? ' · active' : ''}`}
                />
                <span
                  className={`text-[9px] tracking-widest ${
                    d.isToday ? 'text-accent' : 'text-zinc-600'
                  }`}
                >
                  {d.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  )
}
