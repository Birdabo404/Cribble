import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { formatScore } from '@/components/dashboard-v2/format'
import {
  gateProfileForViewer,
  loadPublicProfileCached,
  PROFILE_USERNAME_RE
} from '@/lib/publicProfile'

// Share card for /u/[username] — the unfurl crawlers actually render.
// A pilot dossier in the join gate-pass visual language: lime spine,
// ink panel, pixel numerals. Public profiles unfurl as their owner's
// calling card — avatar, rank plate, lifetime score, top tool — so a
// pasted profile link flexes the pilot instead of a generic banner.
//
// Private accounts and unknown handles fall back to a branded generic
// card with no personal stats, and so does every failure path (missing
// env, db hiccups, avatar rot): a broken unfurl is never acceptable.
//
// ImageResponse cannot read CSS variables, so lime is the literal
// --ref-lime (252 255 0) from globals.css and the podium hues are the
// medal `plate` literals from src/components/leaderboard/types.ts —
// same convention as the /join/[code] card this is modeled on.

export const alt = 'Cribble pilot profile — rank and score on the AI coding leaderboard.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const LIME = 'rgb(252, 255, 0)'
const LIME_DIM = 'rgba(252, 255, 0, 0.3)'
const INK = '#05060a'
const CHALK = '#f4f5f0'
const MUTED = '#8b8f9a'
const SOFT = '#c4c7cf'
const FAINT = '#5c606a'

const SPINE_W = 46
const MAIN_W = size.width - SPINE_W

// The brand fonts and mark are the same files the /join card colocates;
// this route reads them from that directory instead of duplicating
// ~340KB of binaries. They only exist inside the Vercel lambda because
// next.config.mjs lists them under outputFileTracingIncludes for
// '/u/**' — without that key, every profile unfurl silently degrades to
// fallback fonts with no mark in production (same failure mode the join
// card documents).
const JOIN_ASSETS_DIR = path.join(process.cwd(), 'src/app/join/[code]')
const PIXEL_FONT_PATH = path.join(JOIN_ASSETS_DIR, 'press-start-2p.ttf')
const MONO_FONT_PATH = path.join(JOIN_ASSETS_DIR, 'ibm-plex-mono-500.ttf')
const MARK_PATH = path.join(JOIN_ASSETS_DIR, 'cribble-mark.png')

async function loadOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

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
  rank: number | null
  score: number
  topTool: { name: string; percent: number } | null
  memberSince: string
  isTeam: boolean
}

/**
 * Fetch the avatar into a data URL so Satori never blocks on a remote
 * host. twimg stores the blurry 48px `_normal` variant, so try the
 * 400px upgrade first (same swap as leaderboard/Avatar.tsx); a rotted
 * URL falls through every candidate to the monogram tile.
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
 * Resolve a handle to its public card data via the same cached loader
 * the API route and page metadata use, so one Data Cache entry feeds
 * all three. Private accounts and every failure path return null so
 * the caller renders the generic branded card.
 */
async function resolvePilot(rawUsername: string): Promise<Pilot | null> {
  const username = String(rawUsername || '').trim()
  if (!PROFILE_USERNAME_RE.test(username)) return null
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  try {
    const result = await loadPublicProfileCached(username.toLowerCase())()
    if (!result.ok) return null
    // Crawler = anonymous viewer; private accounts get no personal card.
    const profile = gateProfileForViewer(result.profile, null)
    if (profile.isPrivate) return null

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
    console.error('[ProfileOG] personalization failed:', error)
    return null
  }
}

type FontFamily = Record<string, string | number>

/** The pilot as a holographic calling card. Podium ranks tint the foil;
 *  everyone else flies brand lime. */
function PilotPanel({
  pilot,
  pixelFamily,
  monoFamily
}: {
  pilot: Pilot
  pixelFamily: FontFamily
  monoFamily: FontFamily
}) {
  const medal = pilot.rank !== null ? ogMedalFor(pilot.rank) : null
  const theme = medal ? medal.triplet : LIME_TRIPLET
  const avatarRadius = pilot.isTeam ? 20 : 999
  const avatarImgRadius = pilot.isTeam ? 15 : 999

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
      {/* identity row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginTop: 44 }}>
        <div
          style={{
            width: 148,
            height: 148,
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
              width={134}
              height={134}
              alt=""
              style={{ borderRadius: avatarImgRadius, objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                fontSize: 52,
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
            marginLeft: 30,
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
            PILOT PROFILE
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 40,
              color: CHALK,
              display: 'flex',
              ...monoFamily
            }}
          >
            {truncate(pilot.displayName, 18)}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 20,
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
              fontSize: 54,
              color: pilot.rank !== null ? tint(theme, 1) : FAINT,
              textShadow: pilot.rank !== null ? `0 0 28px ${tint(theme, 0.55)}` : undefined,
              display: 'flex',
              ...pixelFamily
            }}
          >
            {pilot.rank !== null ? `#${pilot.rank}` : '—'}
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              letterSpacing: 4,
              color: medal ? tint(theme, 0.8) : MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            {medal ? medal.label : pilot.rank !== null ? 'SEASON RANK' : 'UNRANKED'}
          </div>
        </div>
      </div>

      {/* score tray */}
      <div
        style={{
          marginTop: 40,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 22,
          paddingBottom: 22,
          paddingLeft: 28,
          paddingRight: 28,
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
              marginTop: 14,
              fontSize: 44,
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
            height: 64,
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
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline' }}>
            <div
              style={{
                fontSize: 28,
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
                  fontSize: 21,
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
          marginTop: 26,
          fontSize: 19,
          color: SOFT,
          display: 'flex',
          ...monoFamily
        }}
      >
        {pilot.rank === 1
          ? 'they hold the throne on the AI coding leaderboard.'
          : pilot.rank !== null
            ? `they hold rank #${pilot.rank} on the AI coding leaderboard.`
            : 'enlisted on the AI coding leaderboard.'}
      </div>

      <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />
    </div>
  )
}

/** Branded fallback for private accounts, unknown handles and every
 *  failure path — Cribble pitch only, zero personal stats. */
function GenericPanel({
  pixelFamily,
  monoFamily
}: {
  pixelFamily: FontFamily
  monoFamily: FontFamily
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 64 }}>
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
            marginTop: 24,
            fontSize: 58,
            lineHeight: 1.08,
            color: CHALK,
            display: 'flex',
            ...pixelFamily
          }}
        >
          PILOT
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
          PROFILE
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 21,
            color: SOFT,
            display: 'flex',
            ...monoFamily
          }}
        >
          rank, score and loadout — see who flies what
        </div>
      </div>
      <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />
    </div>
  )
}

export default async function OpengraphImage({
  params
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const [pixelFont, monoFont, mark, pilot] = await Promise.all([
    loadOptional(PIXEL_FONT_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH),
    resolvePilot(username)
  ])
  // Podium owners tint the panel bloom; everyone else keeps brand lime.
  const bloomTriplet =
    pilot && pilot.rank !== null
      ? ogMedalFor(pilot.rank)?.triplet ?? LIME_TRIPLET
      : LIME_TRIPLET
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
            CRIBBLE · SERVICE RECORD
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
            paddingLeft: 44,
            paddingRight: 44
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
                PILOT DOSSIER
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
            <PilotPanel pilot={pilot} pixelFamily={pixelFamily} monoFamily={monoFamily} />
          ) : (
            <GenericPanel pixelFamily={pixelFamily} monoFamily={monoFamily} />
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
              {'// pilot profile'}
            </div>
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
