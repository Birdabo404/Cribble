'use client'

// Capture-optimized holographic trading card — the shareable version of a
// player's leaderboard profile. Rendered off-screen on a fixed 1080x1350
// canvas (4:5, the crop X displays largest) and rasterized by
// share/capture.ts at 3-4x pixelRatio, so everything here is static:
// no animations, no backdrop-filter, no next/image, plain <img> only.
//
// Theme determinism: the --lb-* / --r-* / --px-* tokens flip in light
// mode, so every var the card consumes is re-pinned inline on the root
// with the dark-theme literals (same scoped re-pin idiom as .lx-hero and
// .glass-pop in globals.css). The capture looks identical no matter what
// theme the host page is in.

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { formatNumber, formatScore } from '@/components/dashboard-v2/format'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import type { AchievementIcon } from '@/lib/achievements'
import { ToolIcon } from '@/components/leaderboard/icons'
import { TokenAgentIcon } from '@/components/leaderboard/TokenAgentIcon'
import {
  exactRatioPercent,
  formatCompactTokenCount,
  tokenAgentLabel,
  usdDisplayParts
} from '@/lib/tokenLeaderboard'
import { medalA, medalFor } from '@/components/leaderboard/types'

export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1350

export interface ShareCardTool {
  name: string
  percent: number
}

export interface ShareCardBadge {
  id: string
  name: string
  icon: string
  rarity: string
}

/** Burn-board payload for the ember variant — token counts stay exact
 *  decimal strings so the card formats them with the same helpers the
 *  TokenPlayerCard modal uses. */
export interface ShareCardBurn {
  /** exact decimal USD string, e.g. "86701.23"; null hides the cost line */
  estCostUsd: string | null
  inputTokens: string
  outputTokens: string
  cacheTokens: string
  totalTokens: string
  activeDays: number | null
  /** raw collector agent id — resolves to brand icon + label */
  topAgent: string | null
  /** display label, already resolved via tokenModelLabel */
  topModel: string | null
  /** 0-100 share of tokens; null when attribution is unknown */
  tokenSharePercent: number | null
}

export interface ShareCardData {
  username: string
  displayName: string | null
  profileImage: string | null
  rank: number
  score: number
  todayScore: number
  weekScore: number
  topTools: ShareCardTool[]
  badges: ShareCardBadge[]
  /** ISO date or null */
  memberSince: string | null
  /** square avatar treatment when true */
  isTeam?: boolean
  /** defaults to 'LIFETIME SCORE'; the token board passes its own */
  scoreLabel?: string
  /** only read by the ember variant */
  burn?: ShareCardBurn | null
}

export type ShareCardVariant = 'medal' | 'ember'

// ---------------------------------------------------------------------
// theme tokens, pinned to the dark palette (globals.css :root values)
// ---------------------------------------------------------------------

const CARD_VARS = {
  '--lb-gold': '255 214 68',
  '--lb-gold-hi': '255 240 160',
  '--lb-silver': '216 228 242',
  '--lb-bronze': '255 145 77',
  '--lb-score': '252 255 0',
  '--lb-delta': '255 95 31',
  '--lb-up': '74 222 128',
  '--lb-panel-bg': '9 10 13',
  '--lb-panel-edge': '255 255 255',
  '--lb-glow': '1',
  '--ember-rgb': '255 106 26',
  '--r-common': '161 161 170',
  '--r-rare': '56 189 248',
  '--r-epic': '255 45 149',
  '--r-legendary': '255 214 68',
  '--r-mythic': '205 190 255',
  // PixelIcon material ramps (dark set from src/components/achievements/palette.ts)
  '--px-ember-1': '#7c2d12',
  '--px-ember-2': '#ea580c',
  '--px-ember-3': '#ff8a3d',
  '--px-ember-4': '#ffc466',
  '--px-gold-1': '#8a6512',
  '--px-gold-2': '#d4a017',
  '--px-gold-3': '#ffd644',
  '--px-gold-4': '#fff3b0',
  '--px-ice-1': '#1e5f7a',
  '--px-ice-2': '#4aa8cc',
  '--px-ice-3': '#9bdcf5',
  '--px-ice-4': '#e3f7ff',
  '--px-signal-1': '#0b6e1f',
  '--px-signal-2': '#05c414',
  '--px-signal-3': '#02fe01',
  '--px-signal-4': '#b8ffb0',
  '--px-plasma-1': '#831051',
  '--px-plasma-2': '#d61a7f',
  '--px-plasma-3': '#ff2d95',
  '--px-plasma-4': '#ff9ecb',
  '--px-azure-1': '#14547d',
  '--px-azure-2': '#1e8ec2',
  '--px-azure-3': '#38bdf8',
  '--px-azure-4': '#bae9ff',
  '--px-void-1': '#07080d',
  '--px-void-2': '#14161d',
  '--px-void-3': '#262a35',
  '--px-void-4': '#3d4250',
  '--px-steel-1': '#3f3f46',
  '--px-steel-2': '#71717a',
  '--px-steel-3': '#a1a1aa',
  '--px-steel-4': '#e4e4e7',
  '--px-bone-1': '#8f8a7e',
  '--px-bone-2': '#c9c3b4',
  '--px-bone-3': '#ece7d9',
  '--px-bone-4': '#fffdf5'
} as React.CSSProperties

// Gate-pass lime, the literal --ref-lime from globals.css (same move as
// the /join OG image — the plate must not flip with the theme).
const LIME = 'rgb(252 255 0)'
const LIME_DIM = 'rgb(252 255 0 / 0.3)'
const LIME_FAINT = 'rgb(252 255 0 / 0.12)'
const CHALK = '#f4f5f0'
const INK = '#05060a'

const PIXEL = 'var(--font-pixel)'
const MONO = 'var(--font-data), ui-monospace, monospace'

interface CardTheme {
  /** rgb triplet / var reference for alpha mixing via medalA */
  rgb: string
  /** solid hue for accents */
  fg: string
  /** bright literal triplet for chips on dark scrims */
  plate: string
  label: string | null
}

const themeFor = (variant: ShareCardVariant, rank: number): CardTheme => {
  switch (variant) {
    case 'medal': {
      const medal = medalFor(rank)
      if (medal) return { rgb: medal.rgb, fg: medal.fg, plate: medal.plate, label: medal.label }
      // off-podium: neutral foil edge
      return {
        rgb: 'var(--lb-panel-edge)',
        fg: 'rgb(228 228 231)',
        plate: '244 244 245',
        label: null
      }
    }
    case 'ember':
      return {
        rgb: 'var(--ember-rgb)',
        fg: 'rgb(var(--ember-rgb))',
        plate: '255 138 61',
        label: 'BURN BOARD'
      }
    default: {
      const exhaustive: never = variant
      return exhaustive
    }
  }
}

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

/** Remote avatars go through the same-origin proxy so the capture canvas
 *  is never CORS-tainted. */
const proxied = (src: string) => `/api/img/card-proxy?u=${encodeURIComponent(src)}`

/** twimg stores multiple sizes; OAuth persists the blurry 48px `_normal`
 *  variant — swap in the 400px one (same upgrade as leaderboard/Avatar). */
const upgraded = (src: string) =>
  src.includes('pbs.twimg.com') ? src.replace(/_normal(\.[a-z]+)(\?.*)?$/i, '_400x400$1$2') : src

const monthYear = (iso: string | null) => {
  if (!iso) return null
  return new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()
}

// Replicated from src/lib/inviteCodes.ts — that module imports
// node:crypto for code generation, so it cannot land in a client bundle.
const INVITE_SHAPE = /^CRIB-([A-Z0-9]{4})-([A-Z0-9]{4})$/

const inviteCells = (code: string): string[] | null => {
  const match = code.trim().toUpperCase().match(INVITE_SHAPE)
  if (!match) return null
  return [...match[1], ...match[2]]
}

/** Decorative barcode bars derived from the code itself, so two cards
 *  never carry the same stub — ported from the /join OG image. */
const barcodeWidths = (seed: string): number[] => {
  const source = seed || 'CRIBBLE'
  return Array.from({ length: 26 }, (_, i) => {
    const char = source.charCodeAt(i % source.length)
    return 2 + ((char + i * 7) % 3)
  })
}

/** Press Start glyphs are ~1em wide — shrink the ghost numeral as the
 *  rank gains digits so it never spills past the canvas. */
const ghostRankSize = (rank: number) => {
  if (rank < 10) return 320
  if (rank < 100) return 250
  if (rank < 1000) return 200
  return 155
}

const rarityA = (rarity: string, alpha: number) => `rgb(var(--r-${rarity}) / ${alpha})`

// Mint the modal stamps on USD figures, and the bucket hues of its
// INPUT/OUTPUT/CACHE strip — literals, so the capture never flips.
const USD_MINT = '#39ff88'

// Deliberate pixel-numeral scale: hero, sub (one half-step down — cost,
// token share), cell (meter numerals). No one-off sizes.
const PX_HERO = 88
const PX_SUB = 44
const PX_CELL = 28

// One micro-label voice for every in-tile label (EST. COST, INPUT/OUTPUT/
// CACHE, TOP AGENT, TOP MODEL, TOKEN SHARE). Section headers stay 16px.
const MICRO_LABEL = 'text-[14px] tracking-[0.35em] text-zinc-500'

const BURN_BUCKETS = [
  { key: 'inputTokens', label: 'INPUT', color: 'rgb(96 165 250)' },
  { key: 'outputTokens', label: 'OUTPUT', color: 'rgb(192 132 252)' },
  { key: 'cacheTokens', label: 'CACHE', color: 'rgb(52 211 153)' }
] as const

// ---------------------------------------------------------------------
// component
// ---------------------------------------------------------------------

export function ShareCard({
  data,
  variant,
  inviteLink,
  inviteCode
}: {
  data: ShareCardData
  variant: ShareCardVariant
  inviteLink: string | null
  inviteCode: string | null
}): JSX.Element {
  const theme = themeFor(variant, data.rank)

  // ---- avatar: proxied hi-res → proxied original → monogram ---------
  // A dead URL must never leave the broken-image glyph in the capture.
  const [avatarStage, setAvatarStage] = useState<'hi' | 'original' | 'monogram'>('hi')
  useEffect(() => setAvatarStage('hi'), [data.profileImage])

  const hiSrc = data.profileImage ? proxied(upgraded(data.profileImage)) : null
  const origSrc = data.profileImage ? proxied(data.profileImage) : null
  const avatarSrc = avatarStage === 'hi' ? hiSrc : avatarStage === 'original' ? origSrc : null

  // ---- QR of the invite link (async; renders once the data URL lands) --
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!inviteLink) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(inviteLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 640,
      color: { dark: INK, light: CHALK }
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [inviteLink])

  const scoreLabel = data.scoreLabel ?? 'LIFETIME SCORE'
  const joined = monthYear(data.memberSince)
  const tools = data.topTools.slice(0, 3)

  // Burn payload drives the ember layout only; the medal card keeps its
  // rank story even if a caller passes both.
  const burn = variant === 'ember' ? data.burn ?? null : null
  const cost = burn?.estCostUsd ? usdDisplayParts(burn.estCostUsd) : null
  const burnAgentLabel = burn?.topAgent ? tokenAgentLabel(burn.topAgent) : null

  // up to 8 badge tiles; when there are more, the 8th slot becomes "+N"
  const overflow = data.badges.length > 8 ? data.badges.length - 7 : 0
  const shownBadges = overflow ? data.badges.slice(0, 7) : data.badges.slice(0, 8)

  const normalizedCode = inviteCode ? inviteCode.trim().toUpperCase() : null
  const cells = normalizedCode ? inviteCells(normalizedCode) : null
  const hasInvitePlate = inviteLink !== null || normalizedCode !== null

  const serial = cells
    ? `${cells.slice(0, 4).join('')}-${cells.slice(4).join('')}`
    : `${String(data.rank).padStart(4, '0')}-${(data.username.slice(0, 4) || 'CRIB').toUpperCase()}`

  const avatarOuterRound = data.isTeam ? 'rounded-[36px]' : 'rounded-full'
  const avatarInnerRound = data.isTeam ? 'rounded-[30px]' : 'rounded-full'

  const foilRing =
    variant === 'medal' && data.rank === 1
      ? // champion foil: the modal's spinning ring, frozen at its richest frame
        `conic-gradient(from 40deg, transparent 0deg, ${medalA(theme.rgb, 0.9)} 80deg, rgb(var(--lb-gold-hi)) 120deg, transparent 200deg, ${medalA(theme.rgb, 0.55)} 300deg, transparent 360deg)`
      : `conic-gradient(from 210deg, ${medalA(theme.rgb, 0.9)}, ${medalA(theme.rgb, 0.22)}, ${medalA(theme.rgb, 0.9)})`

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        ...CARD_VARS,
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_HEIGHT,
        // solid opaque ink — the capture must have zero transparency
        background: 'rgb(9 10 13)',
        fontFamily: MONO
      }}
    >
      {/* ---------- banner ---------- */}
      <div className="relative h-[224px] shrink-0 overflow-hidden">
        <div aria-hidden className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background: [
                `radial-gradient(120% 130% at 20% -10%, ${medalA(theme.rgb, 0.3)}, transparent 55%)`,
                `radial-gradient(90% 120% at 95% 10%, ${medalA(theme.rgb, 0.15)}, transparent 60%)`,
                `repeating-linear-gradient(90deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 44px)`,
                `repeating-linear-gradient(0deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 44px)`
              ].join(', ')
            }}
          />
          <span
            className="absolute -bottom-5 right-8 select-none leading-none"
            style={{
              fontFamily: PIXEL,
              fontSize: ghostRankSize(data.rank),
              color: theme.fg,
              opacity: 0.13
            }}
          >
            #{data.rank}
          </span>
          {/* fade into the card body */}
          <div
            className="absolute inset-x-0 bottom-0 h-[120px]"
            style={{ background: 'linear-gradient(180deg, transparent, rgb(9 10 13))' }}
          />
        </div>

        {/* rank plate — dark scrim pill, bright plate literals */}
        <div className="absolute left-12 top-12 flex items-center gap-4">
          <span
            className="rounded-xl px-6 py-4 leading-none"
            style={{
              fontFamily: PIXEL,
              fontSize: 32,
              color: `rgb(${theme.plate})`,
              background: 'rgb(0 0 0 / 0.55)',
              border: `2px solid rgb(${theme.plate} / 0.5)`,
              textShadow: `0 0 28px rgb(${theme.plate} / 0.6)`
            }}
          >
            #{data.rank}
          </span>
          {theme.label && (
            <span
              className="rounded-lg px-4 py-3 text-[17px] leading-none tracking-[0.3em]"
              style={{
                color: theme.fg,
                background: 'rgb(0 0 0 / 0.55)',
                border: `1px solid ${medalA(theme.rgb, 0.45)}`
              }}
            >
              {theme.label}
            </span>
          )}
        </div>

        {/* brand, top-right */}
        <div className="absolute right-12 top-12 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cribble-mark.png" alt="" width={44} height={44} />
          <span className="text-[22px] tracking-[0.4em] text-zinc-300">CRIBBLE</span>
        </div>
      </div>

      {/* ---------- identity ---------- */}
      <div className="relative z-[2] -mt-[112px] flex flex-col items-center px-16">
        <div className="relative h-[188px] w-[188px]">
          <span
            aria-hidden
            className={`absolute -inset-[6px] ${avatarOuterRound}`}
            style={{
              background: foilRing,
              boxShadow: `0 0 44px ${medalA(theme.rgb, 0.3)}`
            }}
          />
          {/* gap between foil and photo */}
          <span
            aria-hidden
            className={`absolute inset-0 ${avatarOuterRound}`}
            style={{ boxShadow: 'inset 0 0 0 6px rgb(9 10 13)' }}
          />
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt=""
              aria-hidden
              className={`absolute inset-[6px] h-[176px] w-[176px] ${avatarInnerRound} object-cover`}
              onError={() =>
                setAvatarStage((s) =>
                  s === 'hi' && hiSrc !== origSrc ? 'original' : 'monogram'
                )
              }
            />
          ) : (
            <span
              className={`absolute inset-[6px] flex h-[176px] w-[176px] items-center justify-center ${avatarInnerRound} bg-zinc-900 font-display text-[72px] font-semibold text-zinc-300`}
            >
              {data.username[0]?.toUpperCase() ?? '?'}
            </span>
          )}
        </div>

        <span className="mt-4 max-w-[900px] truncate font-display text-[46px] font-semibold leading-tight tracking-tight text-zinc-50">
          {data.displayName || `@${data.username}`}
        </span>
        <span className="mt-1 text-[23px] text-zinc-500">@{data.username}</span>
      </div>

      {/* Weighted spacers absorb the canvas slack proportionally, so a
          sparse card (no badges, short footer band) breathes evenly instead
          of pooling all its dead space above the plate. min-heights are the
          old fixed margins — the maximal card still fits with zero overflow. */}
      <div aria-hidden className="min-h-[24px] flex-[0.7]" />

      {/* ---------- score hero ---------- */}
      <div className="flex flex-col items-center px-16">
        <span className="text-[19px] tracking-[0.5em] text-zinc-500">{scoreLabel}</span>
        <span
          className="mt-4 leading-none tabular-nums"
          style={{
            fontFamily: PIXEL,
            fontSize: PX_HERO,
            color: 'rgb(var(--lb-score))',
            textShadow:
              '0 0 34px rgb(var(--lb-score) / 0.5), 0 0 90px rgb(var(--lb-score) / 0.2)'
          }}
        >
          {formatScore(data.score)}
        </span>
        {/* the burn's shadow price — "112B burned → $86,701" is the whole
            point of the ember card */}
        {cost && (
          // mt-3, not mt-4: the pixel hero has no descenders, so the gap
          // below it reads larger than measured — optical correction.
          <div className="mt-3 flex items-baseline justify-center gap-4">
            <span className={MICRO_LABEL}>EST. COST</span>
            <span
              className="leading-none tabular-nums text-zinc-100"
              style={{ fontFamily: PIXEL, fontSize: PX_SUB }}
            >
              {cost.tiny ? '<' : null}
              <span style={{ color: USD_MINT }}>$</span>
              {cost.number}
            </span>
          </div>
        )}
        {/* hidden when both are zero — the token board carries no daily or
            weekly notion, so its cards pass 0/0 */}
        {(data.todayScore > 0 || data.weekScore > 0) && (
          <div className="mt-4 flex items-center gap-5 text-[22px] tabular-nums">
            <span style={{ color: data.todayScore > 0 ? 'rgb(var(--lb-delta))' : 'rgb(82 82 91)' }}>
              +{formatNumber(data.todayScore)} TODAY
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-500">+{formatNumber(data.weekScore)} THIS WEEK</span>
          </div>
        )}
      </div>

      <div aria-hidden className="min-h-[28px] flex-[1.2]" />

      {burn ? (
        <>
          {/* ---------- token mix meter ---------- */}
          <div className="grid grid-cols-3 gap-4 px-16">
            {BURN_BUCKETS.map((bucket) => {
              const value = burn[bucket.key]
              const share = exactRatioPercent(value, burn.totalTokens)
              return (
                <div
                  key={bucket.label}
                  className="rounded-xl px-4 py-4 text-center"
                  style={{
                    background: 'rgb(255 255 255 / 0.035)',
                    border: '1px solid rgb(255 255 255 / 0.09)'
                  }}
                >
                  <div
                    className="leading-none tabular-nums text-zinc-100"
                    style={{ fontFamily: PIXEL, fontSize: PX_CELL }}
                  >
                    {formatCompactTokenCount(value)}
                  </div>
                  <div className={`mt-2 ${MICRO_LABEL}`}>{bucket.label}</div>
                  {/* static fill — share of total tokens, like the modal strip */}
                  <div className="mx-auto mt-3 h-[6px] max-w-[168px] overflow-hidden rounded-full bg-[rgb(255_255_255/0.07)]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2.5, share)}%`, background: bucket.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* ---------- primary stack ---------- */}
          {burnAgentLabel && (
            <div className="mt-7 px-16">
              <div className="text-[16px] tracking-[0.35em] text-zinc-500">PRIMARY STACK</div>
              <div
                className="mt-4 flex items-center gap-8 rounded-2xl py-5 pl-6 pr-9"
                style={{
                  border: `1px solid ${medalA(theme.rgb, 0.26)}`,
                  background: `linear-gradient(120deg, ${medalA(theme.rgb, 0.09)}, rgb(255 255 255 / 0.02) 62%)`
                }}
              >
                <span
                  className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-2xl"
                  style={{
                    border: `2px solid ${medalA(theme.rgb, 0.45)}`,
                    background: 'rgb(0 0 0 / 0.4)',
                    boxShadow: `0 0 44px ${medalA(theme.rgb, 0.22)}, inset 0 0 26px ${medalA(theme.rgb, 0.09)}`
                  }}
                >
                  <TokenAgentIcon agent={burn.topAgent} bare size={58} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={MICRO_LABEL}>TOP AGENT</div>
                  <div className="mt-1 truncate font-display text-[36px] font-semibold leading-tight text-zinc-50">
                    {burnAgentLabel}
                  </div>
                  {burn.topModel && (
                    <div className="mt-2 flex items-baseline gap-3">
                      <span className={`shrink-0 ${MICRO_LABEL}`}>TOP MODEL</span>
                      <span className="truncate text-[18px] text-zinc-300">{burn.topModel}</span>
                    </div>
                  )}
                </div>
                {burn.tokenSharePercent !== null && (
                  <div className="shrink-0 text-right">
                    <div
                      className="leading-none tabular-nums"
                      style={{ fontFamily: PIXEL, fontSize: PX_SUB, color: theme.fg }}
                    >
                      {burn.tokenSharePercent}%
                    </div>
                    <div className={`mt-2 ${MICRO_LABEL}`}>TOKEN SHARE</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        /* ---------- top tools ---------- */
        <div className="px-16">
          <div className="flex items-center justify-between text-[16px] tracking-[0.35em] text-zinc-500">
            <span>TOP TOOLS</span>
            <span className="text-zinc-700">SHARE OF SCORE</span>
          </div>
          <div className="mt-4 space-y-4">
            {tools.length === 0 && (
              <div className="py-3 text-center text-[18px] tracking-[0.2em] text-zinc-600">
                NO FIELD DATA YET
              </div>
            )}
            {tools.map((tool, i) => (
              <div key={tool.name} className="flex items-center gap-6">
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    color: i === 0 ? theme.fg : 'rgb(212 212 216)',
                    background: 'rgb(255 255 255 / 0.045)',
                    border: '1px solid rgb(255 255 255 / 0.1)'
                  }}
                >
                  <ToolIcon name={tool.name} size={30} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate font-display text-[24px] font-medium text-zinc-200">
                      {tool.name}
                    </span>
                    <span className="shrink-0 text-[20px] tabular-nums text-zinc-500">
                      {tool.percent}%
                    </span>
                  </div>
                  {/* static fill — no animation, the capture takes the end state */}
                  <div className="mt-2 h-[8px] overflow-hidden rounded-full bg-[rgb(255_255_255/0.06)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, tool.percent)}%`,
                        background:
                          i === 0
                            ? `linear-gradient(90deg, ${medalA(theme.rgb, 0.55)}, ${theme.fg})`
                            : 'linear-gradient(90deg, rgb(82 82 91), rgb(161 161 170))'
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- badges ---------- */}
      {shownBadges.length > 0 && (
        <div className="mt-7 px-16">
          <div className="flex items-center justify-between text-[16px] tracking-[0.35em] text-zinc-500">
            <span>BADGES</span>
            <span className="tabular-nums text-zinc-700">{data.badges.length} EARNED</span>
          </div>
          <div className="mt-4 grid grid-cols-8 gap-3">
            {shownBadges.map((badge) => (
              <div
                key={badge.id}
                className="flex h-[92px] items-center justify-center rounded-xl"
                style={{
                  background: rarityA(badge.rarity, 0.07),
                  border: `1px solid ${rarityA(badge.rarity, 0.3)}`
                }}
              >
                <PixelIcon name={badge.icon as AchievementIcon} size={52} />
              </div>
            ))}
            {overflow > 0 && (
              <div
                className="flex h-[92px] items-center justify-center rounded-xl text-[20px] tabular-nums text-zinc-400"
                style={{
                  background: 'rgb(255 255 255 / 0.04)',
                  border: '1px solid rgb(255 255 255 / 0.1)'
                }}
              >
                +{overflow}
              </div>
            )}
          </div>
        </div>
      )}

      <div aria-hidden className="min-h-[28px] flex-[1.4]" />

      {/* ---------- invite plate / footer band ---------- */}
      {hasInvitePlate ? (
        <div
          className="relative mx-12 overflow-hidden rounded-2xl"
          style={{
            border: `1px solid ${LIME_FAINT}`,
            background:
              'linear-gradient(180deg, rgb(252 255 0 / 0.07), rgb(252 255 0 / 0.015) 55%, transparent), rgb(0 0 0 / 0.4)'
          }}
        >
          {/* lime spine, echoing the gate pass */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[10px]"
            style={{ background: `linear-gradient(180deg, ${LIME}, rgb(214 217 0))` }}
          />
          <div className="flex items-center gap-10 py-6 pl-14 pr-10">
            <div className="min-w-0 flex-1">
              {/* RECRUIT A PILOT chip */}
              <div
                className="inline-flex items-center gap-4 rounded-lg px-5 py-3"
                style={{ border: `1px solid ${LIME_DIM}`, background: 'rgb(252 255 0 / 0.05)' }}
              >
                <span className="h-[9px] w-[9px] rounded-full" style={{ background: LIME }} />
                <span className="text-[17px] tracking-[0.4em]" style={{ color: LIME }}>
                  RECRUIT A PILOT
                </span>
              </div>

              {/* access code key cells */}
              {normalizedCode && (
                <div className="mt-5 flex items-center">
                  {cells ? (
                    <>
                      <span
                        className="flex h-[60px] items-center rounded-[10px] px-4 text-[17px] tracking-[0.2em] text-zinc-500"
                        style={{
                          border: '2px solid rgb(255 255 255 / 0.1)',
                          background: 'rgb(255 255 255 / 0.03)'
                        }}
                      >
                        CRIB
                      </span>
                      {cells.slice(0, 4).map((char, i) => (
                        <span
                          key={`a-${i}`}
                          className="ml-2 flex h-[60px] w-[54px] items-center justify-center rounded-[10px] text-[24px]"
                          style={{
                            fontFamily: PIXEL,
                            color: LIME,
                            border: `2px solid ${LIME_DIM}`,
                            background: 'rgb(252 255 0 / 0.06)'
                          }}
                        >
                          {char}
                        </span>
                      ))}
                      <span className="mx-3 h-[2px] w-[14px]" style={{ background: LIME_DIM }} />
                      {cells.slice(4).map((char, i) => (
                        <span
                          key={`b-${i}`}
                          className={`flex h-[60px] w-[54px] items-center justify-center rounded-[10px] text-[24px] ${i === 0 ? '' : 'ml-2'}`}
                          style={{
                            fontFamily: PIXEL,
                            color: LIME,
                            border: `2px solid ${LIME_DIM}`,
                            background: 'rgb(252 255 0 / 0.06)'
                          }}
                        >
                          {char}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span
                      className="flex h-[60px] items-center rounded-[10px] px-6 text-[22px]"
                      style={{
                        fontFamily: PIXEL,
                        color: LIME,
                        border: `2px solid ${LIME_DIM}`,
                        background: 'rgb(252 255 0 / 0.06)'
                      }}
                    >
                      {normalizedCode}
                    </span>
                  )}
                </div>
              )}

              {/* decorative barcode + destination */}
              <div className="mt-5 flex items-end gap-8">
                <span aria-hidden className="flex items-end">
                  {barcodeWidths(serial).map((w, i) => (
                    <span
                      key={`bar-${i}`}
                      className={i === 0 ? '' : 'ml-[4px]'}
                      style={{ width: w * 2, height: 40, background: LIME, display: 'block' }}
                    />
                  ))}
                </span>
                <span className="pb-1 text-[18px] tracking-[0.25em]" style={{ color: LIME }}>
                  {normalizedCode
                    ? `CRIBBLE.DEV/JOIN/${normalizedCode}`
                    : 'CRIBBLE.DEV/LEADERBOARD'}
                </span>
              </div>
            </div>

            {/* QR chip — appears once the data URL resolves */}
            {inviteLink && (
              <div className="flex w-[180px] shrink-0 flex-col items-center gap-3">
                {qrDataUrl && (
                  <span className="rounded-xl p-[10px]" style={{ background: CHALK }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt="" width={150} height={150} className="block" />
                  </span>
                )}
                <span className="text-[13px] tracking-[0.35em] text-zinc-500">
                  SCAN TO ENLIST
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="mx-12 flex items-center justify-center border-t py-7"
          style={{ borderColor: 'rgb(255 255 255 / 0.1)' }}
        >
          <span className="text-[20px] tracking-[0.45em] text-zinc-400">
            CRIBBLE.DEV/LEADERBOARD
          </span>
        </div>
      )}

      {/* ---------- small print ---------- */}
      <div className="flex items-center justify-between px-12 pb-7 pt-4 text-[15px] tracking-[0.3em] text-zinc-600 tabular-nums">
        <span className="flex items-center gap-4">
          <span>{joined ? `JOINED ${joined}` : 'FIELD RECORD'}</span>
          {burn?.activeDays != null && (
            <>
              <span className="text-zinc-700">·</span>
              <span>{formatNumber(burn.activeDays)} ACTIVE DAYS</span>
            </>
          )}
        </span>
        <span>NO. {serial}</span>
      </div>

      {/* ---------- holo sheen + scanlines (static, above everything) ---------- */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: [
            'linear-gradient(115deg, transparent 40%, rgb(255 255 255 / 0.05) 47%, rgb(255 255 255 / 0.02) 54%, transparent 62%)',
            `linear-gradient(295deg, transparent 68%, ${medalA(theme.rgb, 0.05)} 82%, transparent 94%)`,
            'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.012) 0 2px, transparent 2px 7px)'
          ].join(', ')
        }}
      />

      {/* collectible hairline frame */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[18px] z-10 rounded-lg"
        style={{ border: `1px solid ${medalA(theme.rgb, 0.16)}` }}
      />
    </div>
  )
}
