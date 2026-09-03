import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { heroFor } from '@/components/status/heroCopy'
import {
  formatUtcDay,
  formatUtcTime,
  lampWord,
  phaseLabel,
  severityLabel
} from '@/components/status/severity'
import { unknownStatusPayload } from '@/lib/status/aggregate'
import { loadStatusWithNotices, STATUS_REVALIDATE_SECONDS } from '@/lib/status/load'
import type { IncidentThread, Severity, StatusPayload } from '@/lib/status/types'

// The /status unfurl — a live instrument plate, not a banner. Whoever
// pastes cribble.dev/status into a feed gets the reading at crawl time:
// the page's own serif verdict ("the stack is loud."), the mono
// sub-line naming who is down, and a seven-lamp strip along the bottom,
// one cell per service, each topped with a bar in its severity ink. An
// open operator notice takes the verdict over exactly as it does on the
// page (heroFor is shared) and adds a hazard-edged incident slip.
//
// Same material as the deep-space page: ink field, chalk type, Plex
// Mono telemetry, hairlines, sharp corners. Severity inks are the
// page's --sev-* tokens in dark mode, repeated here as literals because
// Satori cannot read CSS variables: --sev-ok is the lx-hero chartreuse,
// --sev-warn is ice, --sev-down is ember. The verdict's full stop is the
// one place the overall severity is spent as colour.
//
// force-dynamic like GET /api/status: never rendered at build (no
// vendor feed should be hit there); the shared loader's Data Cache
// entry keeps origin cost to one vendor pass a minute. Every failure
// path paints the honest "watch is incomplete" card — a broken unfurl
// is never acceptable.
//
// Satori quirks (see the root card): every div needs display:flex,
// rgba() wants comma triplets, no text-decoration, no CSS variables.

export const dynamic = 'force-dynamic'
export const alt = 'Cribble status — live health of the stack Cribble rides on.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#05060a'
const CHALK = '#f4f5f0'
const CHALK_DIM = '#c4c7cf'
const MUTED = '#8b8f9a'
const LINE = 'rgba(244, 245, 240, 0.16)'
const LINE_SOFT = 'rgba(244, 245, 240, 0.09)'

const SEV_OK = 'rgb(204, 255, 0)'
const SEV_WARN = '#9bdcf5'
const SEV_DOWN = '#ff6a1a'
const SEV_UNKNOWN = '#71717a'

const MARGIN_X = 60
const STRIP_BAR = 4

/** Sub-line budget: two full mono lines at 22px plus a little of a third. */
const SUB_MAX_CHARS = 170

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

function severityInk(severity: Severity): string {
  switch (severity) {
    case 'operational':
      return SEV_OK
    case 'degraded':
      return SEV_WARN
    case 'outage':
      return SEV_DOWN
    case 'unknown':
      return SEV_UNKNOWN
    default: {
      const exhaustive: never = severity
      return exhaustive
    }
  }
}

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

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

/** The page's starfield at unfurl scale — a few faint specks above the
 *  strip, white-blue, never a severity ink. */
function starField(): Speck[] {
  const rand = makeRand(19990903)
  return Array.from({ length: 11 }, () => ({
    x: rand() * size.width,
    y: 20 + rand() * 300,
    size: rand() < 0.3 ? 2.5 : 1.5,
    alpha: 0.1 + rand() * 0.18
  }))
}

const STARS = starField()

/** Payload for the card: the shared live reading, or an all-unknown
 *  pass when the loader itself fails — heroFor then says "the watch is
 *  incomplete" and every lamp reads NO SIGNAL. */
async function loadPayload(): Promise<StatusPayload> {
  try {
    return await loadStatusWithNotices()
  } catch (err) {
    console.error('[StatusOG] payload failed:', err)
    return unknownStatusPayload(new Date())
  }
}

function tally(payload: StatusPayload): string {
  const count = (severity: Severity) =>
    payload.services.filter((s) => s.severity === severity).length
  const parts = [`${payload.services.length} SERVICES`]
  const clear = count('operational')
  const degraded = count('degraded')
  const down = count('outage')
  const unknown = count('unknown')
  if (clear > 0) parts.push(`${clear} CLEAR`)
  if (degraded > 0) parts.push(`${degraded} DEGRADED`)
  if (down > 0) parts.push(`${down} DOWN`)
  if (unknown > 0) parts.push(`${unknown} NO SIGNAL`)
  return parts.join(' · ')
}

type FontFamily = Record<string, string | number>

/** Tracked mono microcopy — the instrument-plate labels. */
function Micro({
  children,
  monoFamily,
  color = MUTED,
  letterSpacing = 5,
  fontSize = 14
}: {
  children: string
  monoFamily: FontFamily
  color?: string
  letterSpacing?: number
  fontSize?: number
}) {
  return (
    <div
      style={{
        fontSize,
        letterSpacing,
        color,
        display: 'flex',
        whiteSpace: 'nowrap',
        ...monoFamily
      }}
    >
      {children}
    </div>
  )
}

/** The incident slip: one hazard-edged line naming the open thread's
 *  severity, phase and opening stamp — the page bulletin's header strip
 *  at unfurl scale. */
function IncidentSlip({
  thread,
  monoFamily
}: {
  thread: IncidentThread
  monoFamily: FontFamily
}) {
  const ink = severityInk(thread.severity)
  const opened = `OPENED ${formatUtcDay(thread.openedAt.slice(0, 10))} · ${formatUtcTime(
    thread.openedAt
  ).slice(0, 5)} UTC`
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        marginBottom: 22,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 18,
        paddingRight: 18,
        border: `1px solid ${ink}`,
        borderLeftWidth: 6,
        backgroundColor: 'rgba(255, 106, 26, 0.07)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Micro monoFamily={monoFamily} color={CHALK_DIM} letterSpacing={4} fontSize={13}>
          [ INCIDENT ]
        </Micro>
        <div
          style={{
            marginLeft: 18,
            width: 8,
            height: 8,
            backgroundColor: ink,
            display: 'flex'
          }}
        />
        <div style={{ marginLeft: 8, display: 'flex' }}>
          <Micro monoFamily={monoFamily} color={ink} letterSpacing={4} fontSize={13}>
            {severityLabel(thread.severity)}
          </Micro>
        </div>
        <div style={{ marginLeft: 18, display: 'flex' }}>
          <Micro monoFamily={monoFamily} color={CHALK_DIM} letterSpacing={4} fontSize={13}>
            {phaseLabel(thread.phase)}
          </Micro>
        </div>
      </div>
      <Micro monoFamily={monoFamily} letterSpacing={3} fontSize={13}>
        {opened}
      </Micro>
    </div>
  )
}

/** Seven lamps in a hairline rail, one per service, in payload order. */
function LampStrip({
  payload,
  monoFamily
}: {
  payload: StatusPayload
  monoFamily: FontFamily
}) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        border: `1px solid ${LINE}`,
        backgroundColor: 'rgba(244, 245, 240, 0.025)'
      }}
    >
      {payload.services.map((service, index) => {
        const ink = severityInk(service.severity)
        const word =
          service.id === 'cribble' ? lampWord(service.severity) : severityLabel(service.severity)
        return (
          <div
            key={service.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              flexBasis: 0,
              borderLeft: index === 0 ? 'none' : `1px solid ${LINE_SOFT}`
            }}
          >
            <div style={{ height: STRIP_BAR, width: '100%', backgroundColor: ink, display: 'flex' }} />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                paddingTop: 24,
                paddingBottom: 24,
                paddingLeft: 16,
                paddingRight: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 9, height: 9, backgroundColor: ink, display: 'flex' }} />
                <div
                  style={{
                    marginLeft: 10,
                    fontSize: 17,
                    letterSpacing: 2,
                    color: CHALK,
                    display: 'flex',
                    whiteSpace: 'nowrap',
                    ...monoFamily
                  }}
                >
                  {service.name.toUpperCase()}
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'flex' }}>
                <Micro monoFamily={monoFamily} color={ink} letterSpacing={2.5} fontSize={11}>
                  {word}
                </Micro>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default async function OpengraphImage() {
  const [serifRegular, serifItalic, monoFont, mark, payload] = await Promise.all([
    loadOptional(SERIF_REGULAR_PATH),
    loadOptional(SERIF_ITALIC_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH),
    loadPayload()
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

  const serifFamily: FontFamily = serifRegular ? { fontFamily: 'InstrumentSerif' } : {}
  const serifItalicFamily: FontFamily = serifItalic
    ? { fontFamily: 'InstrumentSerif', fontStyle: 'italic' }
    : { fontStyle: 'italic' }
  const monoFamily: FontFamily = monoFont ? { fontFamily: 'PlexMono' } : {}

  const hero = heroFor(payload, false)
  const openThread = payload.notices?.open[0]
  const verdictInk = openThread ? severityInk(openThread.severity) : severityInk(payload.overall)
  const checked = `CHECKED ${formatUtcDay(payload.checkedAt.slice(0, 10))} · ${formatUtcTime(
    payload.checkedAt
  ).slice(0, 5)} UTC`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: INK,
          overflow: 'hidden',
          paddingTop: 44,
          paddingBottom: 30,
          paddingLeft: MARGIN_X,
          paddingRight: MARGIN_X
        }}
      >
        {/* deep-space wash — the page's lx-hero gradient, blue lifting from the rail */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            display: 'flex',
            background:
              'linear-gradient(180deg, rgba(11, 15, 23, 0) 30%, rgba(15, 21, 34, 0.55) 70%, rgba(24, 34, 56, 0.8) 100%)'
          }}
        />
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

        {/* ── masthead ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {markSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={markSrc} width={26} height={26} alt="" />
            ) : null}
            <div style={{ marginLeft: 16, display: 'flex', alignItems: 'center' }}>
              <Micro monoFamily={monoFamily} color={CHALK_DIM} letterSpacing={6} fontSize={15}>
                TELEMETRY
              </Micro>
              <div style={{ marginLeft: 8, marginRight: 14, display: 'flex' }}>
                <Micro monoFamily={monoFamily} color={SEV_OK} letterSpacing={0} fontSize={15}>
                  /
                </Micro>
              </div>
              <Micro monoFamily={monoFamily} letterSpacing={6} fontSize={15}>
                STATUS
              </Micro>
            </div>
          </div>
          <Micro monoFamily={monoFamily} letterSpacing={4} fontSize={15}>
            {checked}
          </Micro>
        </div>

        {/* ── verdict ── the page hero, serif at editorial scale. The
            emphasised word is italic chalk; the full stop is the one
            spend of severity ink. */}
        <div
          style={{
            marginTop: 50,
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            color: CHALK_DIM,
            fontSize: 108,
            lineHeight: 1.05,
            ...serifFamily
          }}
        >
          <div style={{ display: 'flex', whiteSpace: 'pre' }}>{hero.pre}</div>
          <div style={{ display: 'flex', color: CHALK, ...serifItalicFamily }}>{hero.em}</div>
          <div style={{ display: 'flex', color: verdictInk }}>{hero.post}</div>
        </div>

        {/* ── sub-line ── mono, wraps inside the margins */}
        <div
          style={{
            marginTop: 24,
            width: size.width - MARGIN_X * 2,
            fontSize: 22,
            lineHeight: 1.5,
            color: MUTED,
            display: 'flex',
            ...monoFamily
          }}
        >
          {truncate(hero.sub, SUB_MAX_CHARS)}
        </div>

        <div style={{ display: 'flex', flexGrow: 1 }} />

        {openThread ? <IncidentSlip thread={openThread} monoFamily={monoFamily} /> : null}

        <LampStrip payload={payload} monoFamily={monoFamily} />

        {/* ── footer telemetry ── */}
        <div
          style={{
            marginTop: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%'
          }}
        >
          <Micro monoFamily={monoFamily}>CRIBBLE.DEV/STATUS</Micro>
          <Micro monoFamily={monoFamily} color={CHALK_DIM} letterSpacing={4}>
            {tally(payload)}
          </Micro>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: {
        'Cache-Control': `public, s-maxage=${STATUS_REVALIDATE_SECONDS}, stale-while-revalidate=${STATUS_REVALIDATE_SECONDS * 2}`
      }
    }
  )
}
