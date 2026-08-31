import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { formatScore } from '@/components/dashboard-v2/format'
import { inviteKeyCells, normalizeInviteCode } from '@/lib/inviteCodes'
import { gateProfileForViewer, loadPublicProfile } from '@/lib/publicProfile'
import { createServiceClient } from '@/lib/supabaseServer'

// Share card for /join/CODE — the unfurl crawlers actually render.
// A full-bleed Cribble gate pass: lime spine, the login key cells in a
// tray, and a tear-off stub carrying the recruit bounty.
//
// Referral codes resolve to their owner and the main panel becomes that
// pilot's card — avatar, rank plate, lifetime score, top tool — so every
// invite link unfurls as a personal challenge instead of a form letter.
// Anything that breaks that lookup (staff/waitlist codes, unranked
// owners, missing env, db hiccups) falls back to the generic pass, which
// must therefore never depend on the personalization path.
//
// ImageResponse cannot read CSS variables, so lime is the literal
// --ref-lime (252 255 0) from globals.css, and the podium hues are the
// medal `plate` literals from src/components/leaderboard/types.ts —
// the bright variants designed for dark scrims, which this card is.

export const alt = "You're Invited! Join Cribble, the AI coding leaderboard."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const LIME = 'rgb(252, 255, 0)'
const LIME_DIM = 'rgba(252, 255, 0, 0.3)'
const LIME_FAINT = 'rgba(252, 255, 0, 0.12)'
const INK = '#05060a'
const STUB = '#0a0b06'
const CHALK = '#f4f5f0'
const MUTED = '#8b8f9a'
const SOFT = '#c4c7cf'
const FAINT = '#5c606a'

// Spine, perforation gutter and stub are fixed columns; the main panel
// takes the remainder of the 1200px canvas.
const SPINE_W = 46
const PERF_W = 30
const STUB_W = 288
const MAIN_W = size.width - SPINE_W - PERF_W - STUB_W

// These cwd-relative reads only exist inside the Vercel lambda because
// next.config.mjs lists them in outputFileTracingIncludes — without
// that, every unfurl silently degraded to fallback fonts with no brand
// mark in production (public/ deploys to the CDN, not the function, so
// the mark is a colocated copy of public/brand/cribble-mark.png).
const ROUTE_DIR = path.join(process.cwd(), 'src/app/join/[code]')
const PIXEL_FONT_PATH = path.join(ROUTE_DIR, 'press-start-2p.ttf')
const MONO_FONT_PATH = path.join(ROUTE_DIR, 'ibm-plex-mono-500.ttf')
const MARK_PATH = path.join(ROUTE_DIR, 'cribble-mark.png')

async function loadOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

/**
 * Barcode bars derived from the code itself, so two invites never carry
 * the same stub. Purely decorative — nothing scans it.
 */
function barcodeWidths(seed: string): number[] {
  const source = seed || 'CRIBBLE'
  return Array.from({ length: 26 }, (_, i) => {
    const char = source.charCodeAt(i % source.length)
    return 2 + ((char + i * 7) % 3)
  })
}

/* ================= pilot personalization ================= */

const LIME_TRIPLET = '252, 255, 0'

/** rgba() from a comma triplet — Satori's color parser wants commas. */
const tint = (triplet: string, alpha: number) => `rgba(${triplet}, ${alpha})`

/** Podium plate literals from medalFor() in leaderboard/types.ts. */
const ogMedalFor = (rank: number): { triplet: string; label: string } | null => {
  if (rank === 1) return { triplet: '255, 214, 68', label: 'CHAMPION' }
  if (rank === 2) return { triplet: '216, 228, 242', label: 'RUNNER-UP' }
  if (rank === 3) return { triplet: '255, 145, 77', label: 'THIRD' }
  return null
}

const monthYear = (iso: string) =>
  new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value

interface Pilot {
  username: string
  displayName: string
  /** Avatar inlined as a data URL, or null → monogram tile. */
  avatarSrc: string | null
  rank: number
  score: number
  topTool: { name: string; percent: number } | null
  memberSince: string
  isTeam: boolean
}

/**
 * Fetch the owner's avatar into a data URL so Satori never blocks on a
 * remote host. twimg stores the blurry 48px `_normal` variant, so try
 * the 400px upgrade first (same swap as leaderboard/Avatar.tsx); a
 * rotted URL falls through every candidate to the monogram tile.
 */
async function fetchAvatarDataUrl(src: string | null): Promise<string | null> {
  if (!src || !/^https:\/\//i.test(src)) return null
  const upgraded = src.includes('pbs.twimg.com')
    ? src.replace(/_normal(\.[a-z]+)(\?.*)?$/i, '_400x400$1$2')
    : src
  const candidates = upgraded === src ? [src] : [upgraded, src]
  for (const url of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4_000)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) continue
      const type = res.headers.get('content-type') || ''
      if (!type.startsWith('image/')) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength === 0 || buf.byteLength > 5 * 1024 * 1024) continue
      return `data:${type};base64,${buf.toString('base64')}`
    } catch {
      // timeout or network — try the next candidate
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * Resolve an invite code to its owner's public card data. Personal
 * referral codes only — staff/waitlist mints aren't a person's flex.
 * Every failure path returns null so the caller renders the generic
 * pass; a broken unfurl is never acceptable for an invite link.
 */
async function resolvePilot(code: string): Promise<Pilot | null> {
  if (!inviteKeyCells(code)) return null
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  try {
    const supabase = createServiceClient()
    const { data: invite, error } = await supabase
      .from('invite_codes')
      .select('created_by, kind')
      .eq('code', code)
      .maybeSingle()
    if (error || !invite || invite.kind !== 'referral' || !invite.created_by) return null

    const result = await loadPublicProfile(supabase, { userId: Number(invite.created_by) })
    if (!result.ok) return null
    // Crawler = anonymous viewer: private accounts keep rank/score (the
    // board shows them anyway) but their tools stay follower-only.
    const profile = gateProfileForViewer(result.profile, null)
    if (profile.rank === null || profile.score <= 0) return null

    const avatarSrc = await fetchAvatarDataUrl(profile.profile_image)
    const top = profile.topTools[0]
    return {
      username: profile.username,
      displayName: profile.display_name,
      avatarSrc,
      rank: profile.rank,
      score: profile.score,
      topTool: top ? { name: top.name, percent: top.percent } : null,
      memberSince: profile.memberSince,
      isTeam: profile.isTeam
    }
  } catch (error) {
    console.error('[JoinOG] personalization failed:', error)
    return null
  }
}

type FontFamily = Record<string, string | number>

function KeyCell({
  char,
  pixelFamily,
  compact = false
}: {
  char: string
  pixelFamily: FontFamily
  compact?: boolean
}) {
  return (
    <div
      style={{
        width: compact ? 46 : 56,
        height: compact ? 52 : 62,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: compact ? 9 : 10,
        border: `2px solid ${LIME_DIM}`,
        backgroundColor: 'rgba(252, 255, 0, 0.06)',
        fontSize: compact ? 20 : 25,
        color: LIME,
        ...pixelFamily
      }}
    >
      {char}
    </div>
  )
}

/** Hairline + label + the CRIB-····-···· credential box. The compact
 *  cut trades cell size for the pilot panel above it. */
function AccessTray({
  cells,
  normalized,
  pixelFamily,
  monoFamily,
  compact = false
}: {
  cells: string[] | null
  normalized: string
  pixelFamily: FontFamily
  monoFamily: FontFamily
  compact?: boolean
}) {
  const cellGap = compact ? 6 : 8
  const chipHeight = compact ? 52 : 62
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <div
        style={{
          width: MAIN_W - 60,
          height: 2,
          marginBottom: compact ? 18 : 22,
          display: 'flex',
          background: `linear-gradient(90deg, ${LIME} 0%, rgba(252, 255, 0, 0.22) 22%, rgba(252, 255, 0, 0.06) 100%)`
        }}
      />
      <div
        style={{
          fontSize: 13,
          letterSpacing: 5,
          color: MUTED,
          display: 'flex',
          ...monoFamily
        }}
      >
        PERSONAL ACCESS CODE
      </div>
      <div
        style={{
          marginTop: 12,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          paddingTop: compact ? 12 : 14,
          paddingBottom: compact ? 12 : 14,
          paddingLeft: 18,
          paddingRight: 18,
          borderRadius: 14,
          border: `1px solid ${LIME_FAINT}`,
          backgroundColor: 'rgba(0, 0, 0, 0.35)'
        }}
      >
        {/* The CRIB chip only makes sense in front of a real payload —
            a malformed code renders whole, unprefixed. */}
        {cells ? (
          <div
            style={{
              height: chipHeight,
              paddingLeft: 16,
              paddingRight: 16,
              display: 'flex',
              alignItems: 'center',
              borderRadius: compact ? 9 : 10,
              border: '2px solid rgba(255, 255, 255, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              fontSize: compact ? 15 : 17,
              letterSpacing: 3,
              color: MUTED,
              ...monoFamily
            }}
          >
            CRIB
          </div>
        ) : null}
        {cells ? (
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 12 }}>
            {cells.slice(0, 4).map((char, i) => (
              <div key={`a-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : cellGap }}>
                <KeyCell char={char} pixelFamily={pixelFamily} compact={compact} />
              </div>
            ))}
            <div
              style={{
                width: 14,
                height: 2,
                marginLeft: 10,
                marginRight: 10,
                backgroundColor: LIME_DIM,
                display: 'flex'
              }}
            />
            {cells.slice(4).map((char, i) => (
              <div key={`b-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : cellGap }}>
                <KeyCell char={char} pixelFamily={pixelFamily} compact={compact} />
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              height: chipHeight,
              paddingLeft: 22,
              paddingRight: 22,
              display: 'flex',
              alignItems: 'center',
              borderRadius: compact ? 9 : 10,
              border: `2px solid ${LIME_DIM}`,
              backgroundColor: 'rgba(252, 255, 0, 0.06)',
              fontSize: compact ? 18 : 22,
              color: LIME,
              ...pixelFamily
            }}
          >
            {normalized}
          </div>
        )}
      </div>
    </div>
  )
}

/** The personalized middle: the code's owner as a holographic calling
 *  card. Podium ranks tint the foil; everyone else flies brand lime. */
function PilotPanel({
  pilot,
  pixelFamily,
  monoFamily,
  cells,
  normalized
}: {
  pilot: Pilot
  pixelFamily: FontFamily
  monoFamily: FontFamily
  cells: string[] | null
  normalized: string
}) {
  const medal = ogMedalFor(pilot.rank)
  const theme = medal ? medal.triplet : LIME_TRIPLET
  const avatarRadius = pilot.isTeam ? 20 : 999
  const avatarImgRadius = pilot.isTeam ? 15 : 999

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
      {/* identity row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginTop: 26 }}>
        <div
          style={{
            width: 116,
            height: 116,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: avatarRadius,
            border: `3px solid ${tint(theme, 0.7)}`,
            boxShadow: `0 0 36px ${tint(theme, 0.35)}`,
            backgroundColor: 'rgba(255, 255, 255, 0.03)'
          }}
        >
          {pilot.avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pilot.avatarSrc}
              width={104}
              height={104}
              alt=""
              style={{ borderRadius: avatarImgRadius, objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                fontSize: 42,
                color: tint(theme, 1),
                display: 'flex',
                ...pixelFamily
              }}
            >
              {pilot.username[0]?.toUpperCase() ?? '?'}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginLeft: 24,
            flexGrow: 1
          }}
        >
          <div
            style={{
              fontSize: 13,
              letterSpacing: 5,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            {"YOU'RE INVITED BY"}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 33,
              color: CHALK,
              display: 'flex',
              ...monoFamily
            }}
          >
            {truncate(pilot.displayName, 20)}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 17,
              letterSpacing: 2,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            @{truncate(pilot.username, 24)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div
            style={{
              fontSize: 46,
              color: tint(theme, 1),
              textShadow: `0 0 28px ${tint(theme, 0.55)}`,
              display: 'flex',
              ...pixelFamily
            }}
          >
            #{pilot.rank}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              letterSpacing: 4,
              color: medal ? tint(theme, 0.8) : MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            {medal ? medal.label : 'SEASON RANK'}
          </div>
        </div>
      </div>

      {/* score tray */}
      <div
        style={{
          marginTop: 26,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 18,
          paddingBottom: 18,
          paddingLeft: 24,
          paddingRight: 24,
          borderRadius: 14,
          border: `1px solid ${tint(theme, 0.16)}`,
          backgroundColor: 'rgba(0, 0, 0, 0.35)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 13,
              letterSpacing: 5,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            LIFETIME SCORE
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 40,
              color: tint(theme, 1),
              textShadow: `0 0 24px ${tint(theme, 0.45)}`,
              display: 'flex',
              ...pixelFamily
            }}
          >
            {formatScore(pilot.score)}
          </div>
        </div>

        <div
          style={{
            width: 2,
            height: 58,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            display: 'flex'
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div
            style={{
              fontSize: 13,
              letterSpacing: 5,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            {pilot.topTool ? 'TOP TOOL' : 'FLYING SINCE'}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline' }}>
            <div
              style={{
                fontSize: 24,
                color: CHALK,
                display: 'flex',
                ...monoFamily
              }}
            >
              {pilot.topTool ? truncate(pilot.topTool.name, 14) : monthYear(pilot.memberSince)}
            </div>
            {pilot.topTool ? (
              <div
                style={{
                  marginLeft: 14,
                  fontSize: 19,
                  color: tint(theme, 0.85),
                  display: 'flex',
                  ...pixelFamily
                }}
              >
                {pilot.topTool.percent}%
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* the challenge */}
      <div
        style={{
          marginTop: 22,
          fontSize: 19,
          color: SOFT,
          display: 'flex',
          ...monoFamily
        }}
      >
        {pilot.rank === 1
          ? 'they hold the throne. this key skips the gate — come take it.'
          : `they hold rank #${pilot.rank}. this key skips the gate — come take it.`}
      </div>

      <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />

      <AccessTray
        cells={cells}
        normalized={normalized}
        pixelFamily={pixelFamily}
        monoFamily={monoFamily}
        compact
      />
    </div>
  )
}

export default async function OpengraphImage({
  params
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const normalized = normalizeInviteCode(code || '')
  const cells = inviteKeyCells(normalized)
  const serial = cells ? `${cells.slice(0, 4).join('')}-${cells.slice(4).join('')}` : normalized
  const [pixelFont, monoFont, mark, pilot] = await Promise.all([
    loadOptional(PIXEL_FONT_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH),
    resolvePilot(normalized)
  ])
  // Podium owners tint the panel bloom; everyone else keeps brand lime.
  const bloomTriplet = pilot ? ogMedalFor(pilot.rank)?.triplet ?? LIME_TRIPLET : LIME_TRIPLET
  const markSrc = mark ? `data:image/png;base64,${mark.toString('base64')}` : null

  const fonts: Array<{
    name: string
    data: Buffer
    style: 'normal'
    weight: 400 | 500
  }> = []
  if (pixelFont) {
    fonts.push({ name: 'PressStart2P', data: pixelFont, style: 'normal', weight: 400 })
  }
  if (monoFont) {
    fonts.push({ name: 'PlexMono', data: monoFont, style: 'normal', weight: 500 })
  }

  const pixelFamily: Record<string, string | number> = pixelFont
    ? { fontFamily: 'PressStart2P' }
    : { fontWeight: 900, letterSpacing: 4 }
  const monoFamily: Record<string, string | number> = monoFont ? { fontFamily: 'PlexMono' } : {}

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
          backgroundColor: INK,
          overflow: 'hidden'
        }}
      >
        {/* ── lime spine ── */}
        <div
          style={{
            position: 'relative',
            width: SPINE_W,
            height: size.height,
            display: 'flex',
            overflow: 'hidden',
            background: `linear-gradient(180deg, ${LIME}, rgb(214, 217, 0))`
          }}
        >
          {/* Satori rotates around the element's centre without growing its
              parent, so the label is laid out full-length (height × spine)
              and offset back by half the difference on each axis. */}
          <div
            style={{
              position: 'absolute',
              left: (SPINE_W - size.height) / 2,
              top: (size.height - SPINE_W) / 2,
              width: size.height,
              height: SPINE_W,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: 'rotate(-90deg)',
              fontSize: 15,
              letterSpacing: 9,
              color: '#0b0c06',
              ...monoFamily
            }}
          >
            CRIBBLE · PRIVATE BETA
          </div>
        </div>

        {/* ── main panel ── */}
        <div
          style={{
            position: 'relative',
            width: MAIN_W,
            height: size.height,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 30,
            paddingBottom: 32,
            paddingLeft: 30,
            paddingRight: 30
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: MAIN_W,
              height: size.height,
              display: 'flex',
              backgroundImage:
                'linear-gradient(rgba(252, 255, 0, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(252, 255, 0, 0.03) 1px, transparent 1px)',
              backgroundSize: '46px 46px'
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -150,
              left: -110,
              width: 700,
              height: 620,
              display: 'flex',
              background: `radial-gradient(circle, ${tint(bloomTriplet, 0.11)} 0%, ${tint(bloomTriplet, 0)} 66%)`
            }}
          />

          {/* header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 14,
                paddingRight: 16,
                borderRadius: 8,
                border: `1px solid ${LIME_DIM}`,
                backgroundColor: 'rgba(252, 255, 0, 0.05)'
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: LIME,
                  display: 'flex'
                }}
              />
              <div
                style={{
                  marginLeft: 11,
                  fontSize: 14,
                  letterSpacing: 6,
                  color: LIME,
                  display: 'flex',
                  ...monoFamily
                }}
              >
                RECRUIT A PILOT
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center' }}>
              {markSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={markSrc} width={28} height={28} alt="" />
              ) : null}
              <div
                style={{
                  marginLeft: 11,
                  fontSize: 16,
                  letterSpacing: 6,
                  color: SOFT,
                  display: 'flex',
                  ...monoFamily
                }}
              >
                CRIBBLE
              </div>
            </div>
          </div>

          {pilot ? (
            <PilotPanel
              pilot={pilot}
              pixelFamily={pixelFamily}
              monoFamily={monoFamily}
              cells={cells}
              normalized={normalized}
            />
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}
            >
              {/* headline */}
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
                <div
                  style={{
                    fontSize: 13,
                    letterSpacing: 6,
                    color: MUTED,
                    display: 'flex',
                    ...monoFamily
                  }}
                >
                  THE AI CODING LEADERBOARD
                </div>
                <div
                  style={{
                    marginTop: 20,
                    fontSize: 58,
                    lineHeight: 1.08,
                    color: CHALK,
                    display: 'flex',
                    ...pixelFamily
                  }}
                >
                  {"YOU'RE"}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 58,
                    lineHeight: 1.08,
                    color: LIME,
                    textShadow: '0 0 30px rgba(252, 255, 0, 0.5)',
                    display: 'flex',
                    ...pixelFamily
                  }}
                >
                  INVITED!
                </div>
                <div
                  style={{
                    marginTop: 22,
                    fontSize: 21,
                    color: SOFT,
                    display: 'flex',
                    ...monoFamily
                  }}
                >
                  this key skips the gate — the board is open
                </div>
              </div>

              <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />

              {/* the hairline splits the pitch from the credential, so
                  the ticket reads as two halves of one pass */}
              <AccessTray
                cells={cells}
                normalized={normalized}
                pixelFamily={pixelFamily}
                monoFamily={monoFamily}
              />
            </div>
          )}

          {/* footer */}
          <div
            style={{
              marginTop: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%'
            }}
          >
            <div
              style={{
                fontSize: 14,
                letterSpacing: 5,
                color: FAINT,
                display: 'flex',
                ...monoFamily
              }}
            >
              CRIBBLE.DEV
            </div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: 2,
                color: FAINT,
                display: 'flex',
                ...monoFamily
              }}
            >
              {'// no bots beyond this point'}
            </div>
          </div>
        </div>

        {/* ── perforation gutter ── */}
        <div
          style={{
            width: PERF_W,
            height: size.height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 14,
            paddingBottom: 14,
            backgroundColor: INK
          }}
        >
          {Array.from({ length: 14 }, (_, i) => (
            <div
              key={`hole-${i}`}
              style={{
                width: 15,
                height: 15,
                borderRadius: 999,
                backgroundColor: '#000000',
                border: `1px solid rgba(252, 255, 0, 0.16)`,
                display: 'flex'
              }}
            />
          ))}
        </div>

        {/* ── tear-off stub ── */}
        <div
          style={{
            width: STUB_W,
            height: size.height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 34,
            paddingBottom: 30,
            backgroundColor: STUB,
            backgroundImage:
              'linear-gradient(180deg, rgba(252, 255, 0, 0.09), rgba(252, 255, 0, 0.02) 52%, transparent)'
          }}
        >
          <div
            style={{
              fontSize: 13,
              letterSpacing: 5,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            GATE PASS
          </div>
          <div
            style={{
              marginTop: 26,
              fontSize: 30,
              color: LIME,
              textShadow: '0 0 22px rgba(252, 255, 0, 0.42)',
              display: 'flex',
              ...pixelFamily
            }}
          >
            +1,500
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              letterSpacing: 3,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            PTS PER RECRUIT
          </div>

          <div style={{ display: 'flex', flexGrow: 1 }} />

          <div style={{ display: 'flex', alignItems: 'flex-end', height: 62 }}>
            {barcodeWidths(serial).map((w, i) => (
              <div
                key={`bar-${i}`}
                style={{
                  width: w,
                  height: 62,
                  marginLeft: i === 0 ? 0 : 3,
                  backgroundColor: LIME,
                  display: 'flex'
                }}
              />
            ))}
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 14,
              letterSpacing: 4,
              color: LIME,
              display: 'flex',
              ...monoFamily
            }}
          >
            SKIP THE GATE
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 13,
              letterSpacing: 2,
              color: FAINT,
              display: 'flex',
              ...monoFamily
            }}
          >
            {serial ? `NO. ${serial}` : 'NO. ———'}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined
    }
  )
}
