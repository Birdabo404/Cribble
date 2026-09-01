import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { createServiceClient } from '@/lib/supabaseServer'

// The root unfurl — the one frame Cribble gets in someone else's feed.
// A transmission, not a screenshot: the hero's editorial serif headline
// given the whole canvas, "worldwide" made literal by the limb of the
// Earth (the landing globe reduced to one lime line), and IBM Plex Mono
// telemetry pinned to the edges like an instrument plate.
//
// This file-convention image cascades to every route without a closer
// one (/, /leaderboard, /teams, /sponsorship, /status); /join/[code]
// and /u/[username] keep their own crafted cards.
//
// Satori quirks documented on the join card apply here too: every div
// needs display:flex, rgba() wants comma triplets, and there is no
// text-decoration — the lime underline under "worldwide" is a separate
// absolutely-positioned div.

export const revalidate = 3600
export const alt = 'Cribble — a worldwide leaderboard for AI users.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Landing accent — the chartreuse the click-through reveals (.lx-hero
// re-pin in globals.css), NOT the app-wide ref-lime the join card uses.
// Spent exactly three times: the underline, the final period, the
// horizon line. The city lights below the limb read as part of the
// horizon element, and everything else stays ink/chalk/mute.
const LIME = 'rgb(204, 255, 0)'
const INK = '#05060a'
const CHALK = '#f4f5f0'
const MUTED = '#8b8f9a'

const MARGIN_X = 60

// Earth limb: a huge circle mostly below the canvas whose top edge
// forms the horizon arc. r=1800 sags ~100px from apex to canvas edge —
// visibly a planet, not a bowed rule.
const LIMB_DIAMETER = 3600
const LIMB_RADIUS = LIMB_DIAMETER / 2
const LIMB_APEX_Y = 462
const LIMB_LEFT = (size.width - LIMB_DIAMETER) / 2

/** y of the horizon arc at canvas x (only valid while the arc is on-canvas). */
const arcYAt = (x: number) =>
  LIMB_APEX_Y + LIMB_RADIUS - Math.sqrt(LIMB_RADIUS ** 2 - (x - size.width / 2) ** 2)

interface Speck {
  x: number
  y: number
  size: number
  alpha: number
}

/** Deterministic LCG so the composition never shimmers between renders. */
function makeRand(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

/** Sparse city lights on the dark earth fill — pilots on the board.
 *  Kept above the telemetry row so the instrument line stays crisp. */
function cityLights(): Speck[] {
  const rand = makeRand(20260901)
  const dots: Speck[] = []
  for (let i = 0; i < 60 && dots.length < 26; i++) {
    const x = 40 + rand() * (size.width - 80)
    const minY = arcYAt(x) + 16
    const maxY = 566
    if (minY >= maxY) continue
    dots.push({
      x,
      y: minY + rand() * (maxY - minY),
      size: rand() < 0.25 ? 3 : 2,
      alpha: 0.28 + rand() * 0.45
    })
  }
  return dots
}

/** A handful of faint stars in the ink above — the hero starfield at
 *  unfurl scale. White-blue, never lime. */
function starField(): Speck[] {
  const rand = makeRand(4081991)
  return Array.from({ length: 9 }, () => ({
    x: rand() * size.width,
    y: rand() * (LIMB_APEX_Y - 120),
    size: rand() < 0.3 ? 2.5 : 1.5,
    alpha: 0.12 + rand() * 0.2
  }))
}

const CITY_LIGHTS = cityLights()
const STARS = starField()

// Same tracing story as the join card: these cwd-relative reads only
// exist inside the Vercel lambda because next.config.mjs lists them in
// outputFileTracingIncludes. The serif faces are colocated here; the
// mono and brand mark are shared from the join route dir (precedent:
// the /u/** card already borrows them).
const ROUTE_DIR = path.join(process.cwd(), 'src/app')
const JOIN_DIR = path.join(process.cwd(), 'src/app/join/[code]')
const SERIF_REGULAR_PATH = path.join(ROUTE_DIR, 'instrument-serif-regular.ttf')
const SERIF_ITALIC_PATH = path.join(ROUTE_DIR, 'instrument-serif-italic.ttf')
const MONO_FONT_PATH = path.join(JOIN_DIR, 'ibm-plex-mono-500.ttf')
const MARK_PATH = path.join(JOIN_DIR, 'cribble-mark.png')

async function loadOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

/**
 * Live ranked-pilot count — the one instrument reading on the card.
 * Same head-count on user_scores that loadPublicProfile uses to compute
 * rank (rank = users above you + 1, so ranked = total_score > 0).
 * Every failure path returns null and the stat line is silently
 * omitted — a broken unfurl is never acceptable.
 */
async function loadRankedCount(): Promise<number | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  try {
    const supabase = createServiceClient()
    const { count, error } = await supabase
      .from('user_scores')
      .select('user_id', { count: 'exact', head: true })
      .gt('total_score', 0)
    if (error || count === null || count <= 0) return null
    return count
  } catch (error) {
    console.error('[RootOG] ranked count failed:', error)
    return null
  }
}

type FontFamily = Record<string, string | number>

export default async function OpengraphImage() {
  const [serifRegular, serifItalic, monoFont, mark, rankedCount] = await Promise.all([
    loadOptional(SERIF_REGULAR_PATH),
    loadOptional(SERIF_ITALIC_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH),
    loadRankedCount()
  ])
  const markSrc = mark ? `data:image/png;base64,${mark.toString('base64')}` : null

  const fonts: Array<{
    name: string
    data: Buffer
    style: 'normal' | 'italic'
    weight: 400 | 500
  }> = []
  if (serifRegular) {
    fonts.push({ name: 'InstrumentSerif', data: serifRegular, style: 'normal', weight: 400 })
  }
  if (serifItalic) {
    fonts.push({ name: 'InstrumentSerif', data: serifItalic, style: 'italic', weight: 400 })
  }
  if (monoFont) {
    fonts.push({ name: 'PlexMono', data: monoFont, style: 'normal', weight: 500 })
  }

  const serifFamily: FontFamily = serifItalic
    ? { fontFamily: 'InstrumentSerif', fontStyle: 'italic' }
    : { fontStyle: 'italic' }
  const monoFamily: FontFamily = monoFont ? { fontFamily: 'PlexMono' } : {}

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          backgroundColor: INK,
          overflow: 'hidden'
        }}
      >
        {/* deep-space wash — the hero gradient inverted: the blue lift
            rises from the horizon instead of the zenith, so the ink
            reads as looking down at the night side from orbit */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            display: 'flex',
            background:
              'linear-gradient(180deg, rgba(11, 15, 23, 0) 18%, rgba(15, 21, 34, 0.5) 58%, rgba(24, 34, 56, 0.85) 100%)'
          }}
        />

        {/* starfield — a few faint specks, never lime */}
        {STARS.map((star, i) => (
          <div
            key={`star-${i}`}
            style={{
              position: 'absolute',
              left: star.x,
              top: star.y,
              width: star.size,
              height: star.size,
              borderRadius: 999,
              backgroundColor: `rgba(200, 215, 255, ${star.alpha})`,
              display: 'flex'
            }}
          />
        ))}

        {/* ── Earth limb ── the landing globe reduced to one line. The
            box-shadow hugs the arc as atmospheric glow; the gradient's
            first ~2% is the airglow seen just inside the limb. */}
        <div
          style={{
            position: 'absolute',
            left: LIMB_LEFT,
            top: LIMB_APEX_Y,
            width: LIMB_DIAMETER,
            height: LIMB_DIAMETER,
            borderRadius: LIMB_DIAMETER,
            border: `2px solid ${LIME}`,
            // Satori's shadow blur reads ~3x wider than browser CSS (it
            // treats the radius as a Gaussian sigma) — 12px here is the
            // tight halo 30-40px would be in a browser.
            boxShadow: '0 0 12px rgba(204, 255, 0, 0.42)',
            display: 'flex',
            // Airglow just inside the limb. Radial so the glow follows
            // the circular rim — a linear gradient is a horizontal band
            // and pools at the arc's apex instead. Percent stops only:
            // Satori ignores px stops in radial gradients (it spread the
            // lime across the whole disc), and % here resolves against
            // the 1800px radius, putting the rim at 100%.
            background:
              'radial-gradient(circle, #02030a 0%, #02030a 96.5%, rgba(204, 255, 0, 0.02) 97.8%, rgba(204, 255, 0, 0.13) 100%)'
          }}
        />

        {/* city lights — pilots on the board */}
        {CITY_LIGHTS.map((dot, i) => (
          <div
            key={`city-${i}`}
            style={{
              position: 'absolute',
              left: dot.x,
              top: dot.y,
              width: dot.size,
              height: dot.size,
              borderRadius: 999,
              backgroundColor: `rgba(204, 255, 0, ${dot.alpha})`,
              display: 'flex'
            }}
          />
        ))}

        {/* ── masthead ── mark + wordmark left, status right */}
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: MARGIN_X,
            right: MARGIN_X,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {markSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={markSrc} width={38} height={38} alt="" />
            ) : null}
            <div
              style={{
                marginLeft: 14,
                fontSize: 26,
                letterSpacing: 1,
                color: CHALK,
                display: 'flex',
                ...monoFamily
              }}
            >
              cribble.
            </div>
          </div>
          <div
            style={{
              fontSize: 15,
              letterSpacing: 6,
              color: MUTED,
              display: 'flex',
              ...monoFamily
            }}
          >
            LIVE // OPEN BETA
          </div>
        </div>

        {/* ── headline ── the whole card. Instrument Serif italic at
            editorial scale; "worldwide" carries the lime underline
            (its own flex element — Satori has no text-decoration) and
            the sentence ends on a lime period. */}
        <div
          style={{
            position: 'absolute',
            top: 172,
            left: MARGIN_X,
            display: 'flex',
            flexDirection: 'column',
            color: CHALK,
            fontSize: 102,
            lineHeight: 1.14,
            ...serifFamily
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ display: 'flex' }}>a</div>
            <div style={{ position: 'relative', display: 'flex', marginLeft: 26 }}>
              <div style={{ display: 'flex' }}>worldwide</div>
              <div
                style={{
                  position: 'absolute',
                  left: 4,
                  right: 0,
                  bottom: 6,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: LIME,
                  display: 'flex'
                }}
              />
            </div>
            <div style={{ display: 'flex', marginLeft: 26 }}>leaderboard</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ display: 'flex' }}>for AI users</div>
            <div style={{ color: LIME, display: 'flex' }}>.</div>
          </div>
        </div>

        {/* ── telemetry ── mono microcopy along the limb, every string
            with a referent. The ranked count is the one live reading;
            when it can't be fetched the line simply isn't there. */}
        <div
          style={{
            position: 'absolute',
            bottom: 30,
            left: MARGIN_X,
            right: MARGIN_X,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 15,
            letterSpacing: 5,
            color: MUTED,
            ...monoFamily
          }}
        >
          <div style={{ display: 'flex' }}>CRIBBLE.DEV</div>
          {rankedCount !== null ? (
            <div style={{ display: 'flex', color: '#c4c7cf' }}>
              {`${rankedCount.toLocaleString('en-US')} PILOTS RANKED`}
            </div>
          ) : null}
          <div style={{ display: 'flex' }}>ALT 408 KM</div>
        </div>

      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined
    }
  )
}
