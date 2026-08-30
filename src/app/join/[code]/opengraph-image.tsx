import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { inviteKeyCells, normalizeInviteCode } from '@/lib/inviteCodes'
import { createServiceClient } from '@/lib/supabaseServer'
import { loadInviteLinkState } from '@/lib/inviteLinkState'

// Share card for /join/CODE — the unfurl crawlers actually render.
// A full-bleed Cribble gate pass: lime spine, the login key cells in a
// tray, and a tear-off stub carrying the recruit bounty. ImageResponse
// cannot read CSS variables, so lime is the literal --ref-lime
// (252 255 0) from globals.css.

export const alt = 'Check a Cribble invite link.'
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

const MARK_PATH = path.join(process.cwd(), 'public/brand/cribble-mark.png')
const PIXEL_FONT_PATH = path.join(process.cwd(), 'src/app/join/[code]/press-start-2p.ttf')
const MONO_FONT_PATH = path.join(process.cwd(), 'src/app/join/[code]/ibm-plex-mono-500.ttf')

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

function KeyCell({
  char,
  pixelFamily
}: {
  char: string
  pixelFamily: Record<string, string | number>
}) {
  return (
    <div
      style={{
        width: 56,
        height: 62,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        border: `2px solid ${LIME_DIM}`,
        backgroundColor: 'rgba(252, 255, 0, 0.06)',
        fontSize: 25,
        color: LIME,
        ...pixelFamily
      }}
    >
      {char}
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
  let valid = false
  try {
    valid = (await loadInviteLinkState(createServiceClient(), normalized)).status === 'valid'
  } catch {
    valid = false
  }
  const cells = valid ? inviteKeyCells(normalized) : null
  const serial = cells ? `${cells.slice(0, 4).join('')}-${cells.slice(4).join('')}` : 'NOT DISPLAYED'
  const [pixelFont, monoFont, mark] = await Promise.all([
    loadOptional(PIXEL_FONT_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH)
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
              background:
                'radial-gradient(circle, rgba(252, 255, 0, 0.11) 0%, rgba(252, 255, 0, 0) 66%)'
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
                {valid ? 'INVITE VERIFIED' : 'INVITE CHECK'}
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
              {valid ? "YOU'RE" : 'VERIFY'}
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
              {valid ? 'INVITED!' : 'INVITE'}
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
              {valid ? 'this key skips the gate — the board is open' : 'open the link to check its status'}
            </div>
          </div>

          <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />

          {/* access code tray — the hairline splits the pitch from the
              credential, so the ticket reads as two halves of one pass */}
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div
              style={{
                width: MAIN_W - 60,
                height: 2,
                marginBottom: 22,
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
                paddingTop: 14,
                paddingBottom: 14,
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
                    height: 62,
                    paddingLeft: 16,
                    paddingRight: 16,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 10,
                    border: '2px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    fontSize: 17,
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
                    <div key={`a-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : 8 }}>
                      <KeyCell char={char} pixelFamily={pixelFamily} />
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
                    <div key={`b-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : 8 }}>
                      <KeyCell char={char} pixelFamily={pixelFamily} />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    height: 62,
                    paddingLeft: 22,
                    paddingRight: 22,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 10,
                    border: `2px solid ${LIME_DIM}`,
                    backgroundColor: 'rgba(252, 255, 0, 0.06)',
                    fontSize: 22,
                    color: LIME,
                    ...pixelFamily
                  }}
                >
                  {normalized}
                </div>
              )}
            </div>
          </div>

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
