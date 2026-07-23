'use client'

import { useMemo } from 'react'
import { animDelay } from './anim'
import { IconClock, IconFlame } from './DashIcons'
import { Panel } from './Panel'
import { TickGauge } from './TickGauge'
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
 * Right rail beside the hero: the season "mission clock" (segmented day
 * ticks — ice track, ember fill) on top, current streak with a 7-day
 * tracker below. During an intermission the dashboard passes
 * name="INTERMISSION" and the countdown targets the next season's launch
 * instead of the current season's lock.
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
        {/* structural ice haze in place of the old accent glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 h-44 w-44 rounded-full opacity-[0.14] blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgb(var(--ice-rgb)/0.5), transparent 70%)'
          }}
        />
        <div className="relative">
          <div className="anim-fade flex items-baseline justify-between" style={animDelay(80)}>
            <div className="flex items-center gap-2 font-display text-[10px] font-medium tracking-[0.4em] text-zinc-300">
              <IconClock size={12} className="text-ice/70" />
              {name}
            </div>
            <div className="font-data text-[10px] tracking-[0.3em] text-ember tabular-nums">
              {pct}%
            </div>
          </div>
          <div
            className="anim-rise mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums"
            style={animDelay(160)}
          >
            {daysLeft}
            <span className="font-data text-zinc-500 text-sm font-normal tracking-[0.2em]"> {daysLabel}</span>
          </div>
        </div>
        <div className="relative mt-4">
          <TickGauge pct={pct} segments={30} className="h-[10px]" delayMs={300} />
        </div>
      </Panel>

      <Panel className="p-6 flex flex-col justify-between">
        <div className="relative">
          <div
            className="anim-fade flex items-center gap-2 font-display text-[10px] font-medium tracking-[0.4em] text-zinc-300"
            style={animDelay(140)}
          >
            <IconFlame size={12} className="text-ember/80" />
            STREAK
          </div>
          <div
            className="anim-rise mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums"
            style={animDelay(220)}
          >
            {streak}
            <span className="font-data text-zinc-500 text-sm font-normal tracking-[0.2em]"> DAYS</span>
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
                {/* Active cells pop in dark, then ignite one by one after the row lands */}
                <div
                  className={`h-2 w-full max-w-[26px] rounded-full transition-colors ${
                    d.active
                      ? 'anim-ignite bg-ember shadow-[0_0_6px_rgb(var(--ember-rgb)/0.5)]'
                      : 'bg-zinc-900'
                  } ${d.isToday && !d.active ? 'ring-1 ring-ice/50' : ''}`}
                  style={d.active ? animDelay(700 + i * 130) : undefined}
                  title={`${d.key}${d.active ? ' · active' : ''}`}
                />
                <span
                  className={`font-data text-[9px] tracking-widest ${
                    d.isToday ? 'text-ember' : 'text-zinc-600'
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
