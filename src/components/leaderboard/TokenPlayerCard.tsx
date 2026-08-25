'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AnimatedCounter from '@/components/AnimatedCounter'
import { formatNumber } from '@/components/dashboard-v2/format'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { TeamMiniLogo } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { isProTier } from '@/lib/entitlements'
import { prefersReducedMotion } from '@/lib/motion'
import {
  decimalToApproxNumber,
  exactDecimal,
  exactIntegerToSafeNumber,
  exactRatioPercent,
  formatCompactTokenCount,
  formatExactInteger,
  tokenAgentLabel,
  tokenModelLabel,
  usdDisplayParts,
  type TokenBoardRow
} from '@/lib/tokenLeaderboard'
import { Avatar, SafeBannerImg } from './Avatar'
import { IconClose, IconCrown, IconExpand, IconFlame } from './icons'
import { TokenAgentIcon } from './TokenAgentIcon'
import { medalA, medalFor, type PlayerProfile } from './types'

const CLOSE_MS = 200

function UsdValue({ value }: { value: string }) {
  const display = usdDisplayParts(value)

  return (
    <>
      {display.tiny ? '<' : null}
      <span className="text-[#39ff88]">$</span>
      {display.number}
    </>
  )
}

function percent(value: string, total: string): number {
  return exactRatioPercent(value, total)
}

export function TokenPlayerCard({
  row,
  isYou,
  windowLabel,
  onClose
}: {
  row: TokenBoardRow
  isYou: boolean
  windowLabel: string
  onClose: () => void
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const medal = medalFor(row.rank)
  const topAgent = tokenAgentLabel(row.topAgent)
  const topModel = tokenModelLabel(row.topModel)
  const burnPerDay = exactDecimal(
    row.activeDays > 0 ? decimalToApproxNumber(row.burnUsd) / row.activeDays : 0
  )
  const safeTotalTokens = exactIntegerToSafeNumber(row.totalTokens)
  const primaryTokenShare = Math.round(
    Math.max(
      exactRatioPercent(row.topAgentTokens, row.totalTokens),
      exactRatioPercent(row.topModelTokens, row.totalTokens)
    )
  )
  const tokenParts = [
    { label: 'INPUT', value: row.inputTokens, color: 'rgb(96 165 250)' },
    { label: 'OUTPUT', value: row.outputTokens, color: 'rgb(192 132 252)' },
    { label: 'CACHE', value: row.cacheTokens, color: 'rgb(52 211 153)' }
  ]

  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) onCloseRef.current()
    else setClosing(true)
  }, [])

  useEffect(() => {
    if (!closing) return
    const timeout = window.setTimeout(() => onCloseRef.current(), CLOSE_MS)
    return () => window.clearTimeout(timeout)
  }, [closing])

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/profile/${encodeURIComponent(row.username)}`, {
      cache: 'no-store',
      credentials: 'include'
    })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json()
      })
      .then((data) => {
        if (!cancelled && data?.success && data.profile) {
          setProfile(data.profile as PlayerProfile)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [row.username])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [requestClose])

  if (typeof document === 'undefined') return null

  const bannerImage = profile?.banner_image ?? null
  const isTeam = profile?.isTeam === true
  const avatarShape = isTeam ? 'rounded-xl' : 'rounded-full'

  return createPortal(
    <div
      className="tpc-root fixed inset-0 z-[75] flex items-end justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-mono sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Token usage profile — @${row.username}`}
      data-closing={closing ? '' : undefined}
    >
      <button
        type="button"
        className="tpc-backdrop absolute inset-0 cursor-default"
        onClick={requestClose}
        aria-label="Close token profile"
      />

      <div className="tpc-card relative w-full max-w-[440px]">
        <div
          className="max-h-[calc(100svh-1.5rem)] overflow-y-auto overscroll-contain rounded-[28px]"
          style={{
            background: 'rgb(var(--lb-panel-bg))',
            border: `1px solid ${medal ? medalA(medal.rgb, 0.42) : 'rgb(var(--lb-panel-edge) / 0.14)'}`,
            boxShadow: medal
              ? `0 32px 100px -35px ${medalA(medal.rgb, 0.42)}, 0 24px 70px -30px rgb(0 0 0 / 0.92)`
              : '0 32px 90px -32px rgb(0 0 0 / 0.95)',
            scrollbarWidth: 'none'
          }}
        >
          <div className="relative h-32 overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: [
                  'radial-gradient(90% 130% at 12% 0%, rgb(249 115 22 / 0.27), transparent 58%)',
                  'radial-gradient(80% 110% at 95% 10%, rgb(34 197 94 / 0.13), transparent 62%)',
                  'repeating-linear-gradient(90deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)',
                  'repeating-linear-gradient(0deg, rgb(var(--lb-panel-edge) / 0.05) 0 1px, transparent 1px 22px)'
                ].join(', ')
              }}
            />
            {bannerImage && (
              <SafeBannerImg
                src={bannerImage}
                frame={profile?.banner_frame}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-20"
              style={{ background: 'linear-gradient(180deg, transparent, rgb(var(--lb-panel-bg)))' }}
            />
            <span
              aria-hidden
              className="absolute -bottom-2 right-4 select-none text-[50px] leading-none text-orange-400/10 [font-family:var(--font-pixel)]"
            >
              BURN
            </span>

            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span
                className="rounded-lg px-2.5 py-1.5 text-[13px] [font-family:var(--font-pixel)]"
                style={{
                  color: medal ? `rgb(${medal.plate})` : 'rgb(244 244 245)',
                  background: 'rgb(0 0 0 / 0.58)',
                  border: `1px solid ${medal ? `rgb(${medal.plate} / 0.5)` : 'rgb(255 255 255 / 0.14)'}`
                }}
              >
                #{row.rank}
              </span>
              <span
                className="border px-2 py-1 text-[8px] font-semibold tracking-[0.18em]"
                style={{
                  color: 'rgb(251 146 60)',
                  borderColor: 'rgb(251 146 60 / 0.38)',
                  background: 'rgb(0 0 0 / 0.58)'
                }}
              >
                {row.persona.label}
              </span>
            </div>

            <div className="absolute right-3 top-3 flex items-center gap-2">
              <Link
                href={`/u/${encodeURIComponent(row.username)}`}
                aria-label="Open full profile"
                title="Open full profile"
                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-white sm:h-8 sm:w-8"
                style={{ background: 'rgb(0 0 0 / 0.58)', border: '1px solid rgb(255 255 255 / 0.14)' }}
              >
                <IconExpand size={14} />
              </Link>
              <button
                type="button"
                onClick={requestClose}
                autoFocus
                aria-label="Close token profile"
                className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition-colors hover:text-white sm:h-8 sm:w-8"
                style={{ background: 'rgb(0 0 0 / 0.58)', border: '1px solid rgb(255 255 255 / 0.14)' }}
              >
                <IconClose size={14} />
              </button>
            </div>
          </div>

          <div className="relative -mt-10 flex flex-col items-center px-6">
            <div className="relative">
              {row.rank === 1 && (
                <IconCrown
                  size={20}
                  className="absolute -top-7 left-1/2 -translate-x-1/2 text-[rgb(var(--lb-gold))] [filter:drop-shadow(0_0_7px_rgb(var(--lb-gold)/0.65))]"
                />
              )}
              <div
                className={`relative h-[82px] w-[82px] ${avatarShape}`}
                style={{
                  padding: 3,
                  background: medal
                    ? `conic-gradient(from 210deg, ${medalA(medal.rgb, 0.95)}, rgb(249 115 22 / 0.34), ${medalA(medal.rgb, 0.95)})`
                    : 'linear-gradient(145deg, rgb(249 115 22 / 0.55), rgb(var(--lb-panel-edge) / 0.16))'
                }}
              >
                <Avatar
                  src={row.profileImage}
                  char={(row.displayName || row.username)[0]?.toUpperCase() ?? '?'}
                  imgClassName={`h-full w-full object-cover ${avatarShape}`}
                  fallbackClassName={`flex h-full w-full items-center justify-center bg-zinc-900 text-2xl text-zinc-300 font-display ${avatarShape}`}
                />
              </div>
            </div>

            <div className="mt-3 flex max-w-full items-center gap-2">
              <span className="truncate font-display text-lg font-semibold tracking-tight text-zinc-50">
                {row.displayName}
              </span>
              {isProTier(profile?.tier) && <VerifiedBadge size={15} />}
              {isTeam && <TeamBadge size={15} />}
              {profile?.team && <TeamMiniLogo team={profile.team} size={15} />}
              {isYou && (
                <span className="border border-orange-400/35 bg-orange-400/[0.08] px-1.5 py-0.5 text-[8px] tracking-[0.2em] text-orange-300">
                  YOU
                </span>
              )}
            </div>
            <span className="mt-0.5 text-[11px] text-zinc-500">@{row.username}</span>
          </div>

          <div className="mt-5 px-6 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[9px] tracking-[0.36em] text-zinc-500">
              <IconFlame size={11} className="text-orange-400" />
              TOKENS BURNED · {windowLabel}
            </div>
            <div
              className="mt-2 text-[31px] leading-none tabular-nums [font-family:var(--font-pixel)]"
              style={{
                color: 'rgb(251 146 60)',
                textShadow: '0 0 22px rgb(249 115 22 / calc(0.42 * var(--lb-glow, 1)))'
              }}
              title={`${formatExactInteger(row.totalTokens)} tokens`}
            >
              {safeTotalTokens === null ? (
                formatCompactTokenCount(row.totalTokens)
              ) : (
                <AnimatedCounter
                  value={safeTotalTokens}
                  duration={900}
                  formatter={(value) => formatCompactTokenCount(String(Math.round(value)))}
                />
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-center gap-2">
              <span className="text-[9px] tracking-[0.24em] text-zinc-600">EST. COST</span>
              <span
                className="text-[17px] text-zinc-100 tabular-nums [font-family:var(--font-pixel)]"
              >
                <UsdValue value={row.burnUsd} />
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 border-y border-[rgb(var(--lb-panel-edge)/0.08)]">
            {tokenParts.map((part, index) => (
              <div
                key={part.label}
                className={`min-w-0 px-3 py-3.5 text-center ${index > 0 ? 'border-l border-[rgb(var(--lb-panel-edge)/0.08)]' : ''}`}
              >
                <div className="truncate text-[11px] tabular-nums text-zinc-200 [font-family:var(--font-pixel)]">
                  {formatCompactTokenCount(part.value)}
                </div>
                <div className="mt-1 text-[8px] tracking-[0.2em] text-zinc-600">{part.label}</div>
                <div className="mx-auto mt-2 h-0.5 max-w-16 overflow-hidden rounded-full bg-[rgb(var(--lb-panel-edge)/0.07)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${percent(part.value, row.totalTokens)}%`, background: part.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 py-5">
            <div className="text-[9px] tracking-[0.34em] text-zinc-500">PRIMARY STACK</div>
            <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[rgb(var(--lb-panel-edge)/0.1)] bg-[rgb(var(--lb-panel-edge)/0.025)] p-3">
              <TokenAgentIcon agent={row.topAgent} size={22} mixed={row.agents.length > 1} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[13px] font-medium text-zinc-100">
                  {topAgent ?? (row.agents.length > 1 ? 'Mixed agents' : 'Agent not reported')}
                </div>
                <div className="mt-1 truncate text-[10px] text-zinc-500">
                  {topModel ?? 'Model not reported'}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] tabular-nums text-zinc-300 [font-family:var(--font-pixel)]">
                  {primaryTokenShare}%
                </div>
                <div className="mt-1 text-[7px] tracking-[0.16em] text-zinc-600">TOKEN SHARE</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="ACTIVE DAYS" value={formatNumber(row.activeDays)} />
              <Metric label="DEVICES" value={formatNumber(row.clientCount)} />
              <Metric label="BURN / DAY" value={burnPerDay} usd />
            </div>

            {(row.agentBreakdown.length > 0 || row.modelBreakdown.length > 0) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Breakdown
                  label="AGENTS BY TOKENS"
                  items={row.agentBreakdown.map((item) => ({
                    label: tokenAgentLabel(item.name) ?? item.name,
                    percent: exactRatioPercent(item.totalTokens, row.totalTokens)
                  }))}
                  complete={row.agentBreakdownComplete}
                />
                <Breakdown
                  label="MODELS BY TOKENS"
                  items={row.modelBreakdown.map((item) => ({
                    label: tokenModelLabel(item.name) ?? item.name,
                    percent: exactRatioPercent(item.totalTokens, row.totalTokens)
                  }))}
                  complete={row.modelBreakdownComplete}
                />
              </div>
            )}

            {(row.models.length > 1 || row.agents.length > 1) && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {row.models.slice(0, 4).map((model) => (
                  <span
                    key={model}
                    className="rounded-md border border-[rgb(var(--lb-panel-edge)/0.1)] bg-[rgb(var(--lb-panel-edge)/0.025)] px-2 py-1 text-[8px] text-zinc-500"
                  >
                    {tokenModelLabel(model)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[rgb(var(--lb-panel-edge)/0.08)] px-6 py-4 text-center text-[8px] leading-4 tracking-[0.18em] text-zinc-600">
            OPT-IN · SELF-REPORTED · COST IS AN ESTIMATE, NOT A BILLING RECEIPT
          </div>
        </div>
      </div>

      <style jsx global>{`
        .tpc-backdrop {
          background: rgb(0 0 0 / 0.8);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: tpc-fade-in 220ms ease backwards;
        }
        html.light .tpc-backdrop { background: rgb(255 255 255 / 0.74); }
        .tpc-card { animation: tpc-card-in 410ms cubic-bezier(0.22, 1.18, 0.36, 1) backwards; }
        .tpc-root[data-closing] { pointer-events: none; }
        .tpc-root[data-closing] .tpc-backdrop { animation: tpc-fade-out ${CLOSE_MS}ms ease forwards; }
        .tpc-root[data-closing] .tpc-card { animation: tpc-card-out ${CLOSE_MS}ms ease forwards; }
        @keyframes tpc-fade-in { from { opacity: 0; } }
        @keyframes tpc-fade-out { to { opacity: 0; } }
        @keyframes tpc-card-in { from { opacity: 0; transform: translateY(24px) scale(0.94); } }
        @keyframes tpc-card-out { to { opacity: 0; transform: translateY(16px) scale(0.96); } }
        @media (prefers-reduced-motion: reduce) {
          .tpc-backdrop, .tpc-card { animation: none; }
        }
      `}</style>
    </div>,
    document.body
  )
}

function Metric({
  label,
  value,
  usd = false
}: {
  label: string
  value: string
  usd?: boolean
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[rgb(var(--lb-panel-edge)/0.08)] px-2 py-2.5 text-center">
      <div className="truncate text-[10px] text-zinc-300 tabular-nums [font-family:var(--font-pixel)]">
        {usd ? <UsdValue value={value} /> : value}
      </div>
      <div className="mt-1 truncate text-[7px] tracking-[0.14em] text-zinc-600">{label}</div>
    </div>
  )
}

function Breakdown({
  label,
  items,
  complete
}: {
  label: string
  items: Array<{ label: string; percent: number }>
  complete: boolean
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--lb-panel-edge)/0.08)] p-3">
      <div className="text-[7px] tracking-[0.16em] text-zinc-600">{label}</div>
      <div className="mt-2 space-y-1.5">
        {items.slice(0, 4).map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-2 text-[9px]">
            <span className="truncate text-zinc-400">{item.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-300 [font-family:var(--font-pixel)]">
              {Math.round(item.percent)}%
            </span>
          </div>
        ))}
      </div>
      {!complete && (
        <div className="mt-2 text-[7px] leading-3 text-zinc-700">PARTIAL · LEGACY DAYS OMITTED</div>
      )}
    </div>
  )
}
