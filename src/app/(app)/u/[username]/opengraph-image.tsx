import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { formatScore } from '@/components/dashboard-v2/format'
import {
  gateProfileForViewer,
  loadPublicProfileCached,
  PROFILE_USERNAME_RE
} from '@/lib/publicProfile'
import { ROLE_META } from '@/lib/roles'
import { designationFor } from './designation'

// Share card for /u/[username] — the unfurl crawlers actually render.
// The pilot's UNIT RECORD on the same paper material as the rebuilt
// profile page: flat ink on paper, 1px hairline frames with corner
// ticks, a 6px dot screen, pixel numerals. Public profiles unfurl as
// their owner's record — square avatar, rank, designation line,
// lifetime score, top tool — so a pasted profile link flexes the pilot
// instead of a generic banner.
//
// Private accounts and unknown handles fall back to a branded generic
// card with no personal stats, and so does every failure path (missing
// env, db hiccups, avatar rot): a broken unfurl is never acceptable.
//
// ImageResponse cannot read CSS variables, so the --pf-* paper tokens
// from dossier.css are repeated below as literal hex. No radius, shadow
// or glow anywhere — the material is hairlines and flat ink, and Satori
// only ever sees rgba() with commas.

export const alt = 'Cribble unit record — rank and score on the AI coding leaderboard.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const PAPER = '#D6D1B8'
const PAPER_2 = '#CCC7AE'
const INK = '#454138'
const INK_2 = '#565244'
const INK_3 = '#777259'
const LINE = '#9C9781'
const LINE_SOFT = '#B9B49C'

/** Outer frame inset from the canvas edge. */
const FRAME = 28
/** Corner tick leg length and how far its elbow sits outside the frame. */
const TICK = 8
const TICK_OUT = 4
const AVATAR = 148

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

/** Podium inks — the medal hues re-mixed for paper, not the plate foils. */
const ogMedalFor = (rank: number): { ink: string; label: string } | null => {
  if (rank === 1) return { ink: '#866A17', label: 'CHAMPION' }
  if (rank === 2) return { ink: INK_2, label: 'RUNNER-UP' }
  if (rank === 3) return { ink: '#8C4E24', label: 'THIRD' }
  return null
}

const monthYear = (iso: string) =>
  new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    .toUpperCase()

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value

interface Pilot {
  userId: number
  username: string
  displayName: string
  /** Avatar inlined as a data URL, or null → monogram tile. */
  avatarSrc: string | null
  rank: number | null
  score: number
  topTool: { name: string; percent: number } | null
  memberSince: string
  isTeam: boolean
  /** Uppercase role badge (ROLE_META), or null when no role is set. */
  roleLabel: string | null
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
      userId: profile.userId,
      username: profile.username,
      displayName: profile.display_name,
      avatarSrc,
      rank: profile.rank,
      score: profile.score,
      topTool: top ? { name: top.name, percent: top.percent } : null,
      memberSince: profile.memberSince,
      isTeam: profile.isTeam,
      roleLabel: profile.role ? ROLE_META[profile.role] ?? null : null
    }
  } catch (error) {
    console.error('[ProfileOG] personalization failed:', error)
    return null
  }
}

type FontFamily = Record<string, string | number>

/**
 * Four L-shaped corner ticks (8px legs, 1px ink) around a box that sits
 * `inset` px inside a position: relative parent of the given size — the
 * .pf-brackets anatomy from dossier.css. Satori has no pseudo-elements,
 * so each leg is its own absolutely positioned div, returned as a flat
 * array of children, anchored by left/top from the parent's known size.
 */
function cornerTicks(width: number, height: number, inset: number, color: string) {
  const near = inset - TICK_OUT
  const farX = width - inset + TICK_OUT
  const farY = height - inset + TICK_OUT
  const legs: Array<[string, number, number, number, number]> = [
    ['tl-h', near, near, TICK, 1],
    ['tl-v', near, near, 1, TICK],
    ['tr-h', farX - TICK, near, TICK, 1],
    ['tr-v', farX - 1, near, 1, TICK],
    ['bl-h', near, farY - 1, TICK, 1],
    ['bl-v', near, farY - TICK, 1, TICK],
    ['br-h', farX - TICK, farY - 1, TICK, 1],
    ['br-v', farX - 1, farY - TICK, 1, TICK]
  ]
  return legs.map(([key, left, top, w, h]) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        display: 'flex',
        left,
        top,
        width: w,
        height: h,
        backgroundColor: color
      }}
    />
  ))
}

/** Inline ink stamp (role, medal): 1px rule in its own colour, tracked
 *  mono caps. Right padding drops the trailing letter-space. */
function Stamp({
  color,
  monoFamily,
  children
}: {
  color: string
  monoFamily: FontFamily
  children: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        paddingTop: 3,
        paddingBottom: 3,
        paddingLeft: 8,
        paddingRight: 5,
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        letterSpacing: 3,
        ...monoFamily
      }}
    >
      {children}
    </div>
  )
}

/** Tracked micro label over a tray cell or the generic pitch. */
function Micro({
  children,
  monoFamily,
  letterSpacing = 5
}: {
  children: string
  monoFamily: FontFamily
  letterSpacing?: number
}) {
  return (
    <div
      style={{
        fontSize: 13,
        letterSpacing,
        color: INK_3,
        display: 'flex',
        ...monoFamily
      }}
    >
      {children}
    </div>
  )
}

/** The pilot's unit record: identity row, score tray, one-line brief. */
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
  const rankInk = medal ? medal.ink : pilot.rank !== null ? INK : INK_3
  const designation = designationFor({
    userId: pilot.userId,
    rank: pilot.rank,
    roleLabel: pilot.roleLabel
  }).line

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
      {/* identity row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', marginTop: 40 }}>
        {/* avatar well — square, hairline frame, corner ticks */}
        <div style={{ position: 'relative', width: AVATAR, height: AVATAR, display: 'flex' }}>
          <div
            style={{
              width: AVATAR,
              height: AVATAR,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${LINE}`,
              backgroundColor: PAPER_2
            }}
          >
            {pilot.avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pilot.avatarSrc}
                width={AVATAR - 2}
                height={AVATAR - 2}
                alt=""
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  fontSize: 52,
                  color: INK_2,
                  display: 'flex',
                  ...pixelFamily
                }}
              >
                {pilot.username[0]?.toUpperCase() ?? '?'}
              </div>
            )}
          </div>
          {cornerTicks(AVATAR, AVATAR, 0, INK)}
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
              fontSize: 40,
              color: INK,
              display: 'flex',
              ...monoFamily
            }}
          >
            {truncate(pilot.displayName, 18)}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 20,
              letterSpacing: 2,
              color: INK_2,
              display: 'flex',
              ...monoFamily
            }}
          >
            {`@${truncate(pilot.username, 24)}`}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              letterSpacing: 4,
              color: INK_3,
              display: 'flex',
              ...monoFamily
            }}
          >
            {designation}
          </div>
          {pilot.roleLabel || medal ? (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center' }}>
              {pilot.roleLabel ? (
                <Stamp color={INK_2} monoFamily={monoFamily}>
                  {pilot.roleLabel}
                </Stamp>
              ) : null}
              {medal ? (
                <div style={{ marginLeft: pilot.roleLabel ? 8 : 0, display: 'flex' }}>
                  <Stamp color={medal.ink} monoFamily={monoFamily}>
                    {medal.label}
                  </Stamp>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div
            style={{
              fontSize: 54,
              color: rankInk,
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
              color: INK_3,
              display: 'flex',
              ...monoFamily
            }}
          >
            {medal ? medal.label : pilot.rank !== null ? 'SEASON RANK' : 'UNRANKED'}
          </div>
        </div>
      </div>

      {/* score tray — hairline well, inner rule between the two cells */}
      <div
        style={{
          marginTop: 34,
          width: '100%',
          display: 'flex',
          alignItems: 'stretch',
          border: `1px solid ${LINE}`,
          backgroundColor: PAPER_2
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            flexBasis: 0,
            paddingTop: 20,
            paddingBottom: 20,
            paddingLeft: 26,
            paddingRight: 26
          }}
        >
          <Micro monoFamily={monoFamily}>LIFETIME SCORE</Micro>
          <div
            style={{
              marginTop: 14,
              fontSize: 44,
              color: INK,
              display: 'flex',
              ...pixelFamily
            }}
          >
            {formatScore(pilot.score)}
          </div>
        </div>

        <div style={{ width: 1, backgroundColor: LINE_SOFT, display: 'flex' }} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            flexGrow: 1,
            flexBasis: 0,
            paddingTop: 20,
            paddingBottom: 20,
            paddingLeft: 26,
            paddingRight: 26
          }}
        >
          <Micro monoFamily={monoFamily}>{pilot.topTool ? 'TOP TOOL' : 'FLYING SINCE'}</Micro>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline' }}>
            <div
              style={{
                fontSize: 28,
                color: INK,
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
                  color: INK_2,
                  display: 'flex',
                  ...pixelFamily
                }}
              >
                {`${pilot.topTool.percent}%`}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* the brief */}
      <div
        style={{
          marginTop: 26,
          fontSize: 19,
          color: INK_2,
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

/** One cell of the generic card's tray: a micro label over an ink-3
 *  dash in the pixel face — a field nobody has filled in. */
function BlankCell({
  label,
  pixelFamily,
  monoFamily
}: {
  label: string
  pixelFamily: FontFamily
  monoFamily: FontFamily
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        flexBasis: 0,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 26,
        paddingRight: 26
      }}
    >
      <Micro monoFamily={monoFamily}>{label}</Micro>
      <div
        style={{
          marginTop: 14,
          fontSize: 44,
          color: INK_3,
          display: 'flex',
          ...pixelFamily
        }}
      >
        —
      </div>
    </div>
  )
}

/** Branded fallback for private accounts, unknown handles and every
 *  failure path — Cribble pitch only, zero personal stats. Under the
 *  pitch it carries the pilot card's tray as a blank form (RANK / SCORE
 *  / LOADOUT over dashes), so the card is visibly an unfilled record
 *  rather than a headline over 40% empty paper. */
function GenericPanel({
  pixelFamily,
  monoFamily
}: {
  pixelFamily: FontFamily
  monoFamily: FontFamily
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44 }}>
        <Micro monoFamily={monoFamily} letterSpacing={6}>
          THE AI CODING LEADERBOARD
        </Micro>
        <div
          style={{
            marginTop: 24,
            fontSize: 58,
            lineHeight: 1.08,
            color: INK,
            display: 'flex',
            ...pixelFamily
          }}
        >
          UNIT
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 58,
            lineHeight: 1.08,
            color: INK,
            display: 'flex',
            ...pixelFamily
          }}
        >
          RECORD
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 21,
            color: INK_2,
            display: 'flex',
            ...monoFamily
          }}
        >
          rank, score and loadout — see who flies what
        </div>
      </div>

      {/* the blank tray — PilotPanel's score tray, unfilled */}
      <div
        style={{
          marginTop: 36,
          width: '100%',
          display: 'flex',
          alignItems: 'stretch',
          border: `1px solid ${LINE}`,
          backgroundColor: PAPER_2
        }}
      >
        <BlankCell label="RANK" pixelFamily={pixelFamily} monoFamily={monoFamily} />
        <div style={{ width: 1, backgroundColor: LINE_SOFT, display: 'flex' }} />
        <BlankCell label="SCORE" pixelFamily={pixelFamily} monoFamily={monoFamily} />
        <div style={{ width: 1, backgroundColor: LINE_SOFT, display: 'flex' }} />
        <BlankCell label="LOADOUT" pixelFamily={pixelFamily} monoFamily={monoFamily} />
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

  // No overflow: hidden on the sheet — Satori's clip for it eats the 1px
  // tick legs, and nothing here reaches past the canvas anyway.
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: PAPER
        }}
      >
        {/* 6px dot screen over the whole sheet (under the ink). Satori's
            radial-gradient ignores px stops, so the page's 0.6px/0.8px are
            given as a share of the 6px tile's farthest-corner radius. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            display: 'flex',
            backgroundImage:
              'radial-gradient(circle, rgba(69, 65, 56, 0.16) 14%, transparent 19%)',
            backgroundSize: '6px 6px'
          }}
        />

        {/* ── frame ── */}
        <div
          style={{
            position: 'absolute',
            top: FRAME,
            left: FRAME,
            width: size.width - FRAME * 2,
            height: size.height - FRAME * 2,
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${LINE}`,
            paddingTop: 28,
            paddingBottom: 26,
            paddingLeft: 36,
            paddingRight: 36
          }}
        >
          {/* header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 6, height: 6, backgroundColor: INK, display: 'flex' }} />
              <div
                style={{
                  marginLeft: 10,
                  fontSize: 14,
                  letterSpacing: 5,
                  color: INK_2,
                  display: 'flex',
                  ...monoFamily
                }}
              >
                UNIT RECORD
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center' }}>
              {markSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={markSrc} width={24} height={24} alt="" />
              ) : null}
              <div
                style={{
                  marginLeft: 10,
                  fontSize: 14,
                  letterSpacing: 5,
                  color: INK_2,
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
                color: INK_3,
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
                color: INK_3,
                display: 'flex',
                ...monoFamily
              }}
            >
              {'// UNIT RECORD'}
            </div>
          </div>
        </div>

        {/* corner ticks just outside the frame */}
        {cornerTicks(size.width, size.height, FRAME, INK)}
      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined
    }
  )
}
