import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { inviteKeyCells, normalizeInviteCode } from '@/lib/inviteCodes'

// Share card for /join/CODE — the unfurl crawlers actually render.
// A Cribble gate pass, not a centered poster: referral-plate lime, the
// login key cells, and a perforated stub with the recruit bounty.
// ImageResponse cannot read CSS variables, so lime is the literal
// --ref-lime (252 255 0) from globals.css.

export const alt = "You're Invited! Join Cribble, the AI coding leaderboard."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const LIME = 'rgb(252, 255, 0)'
const LIME_DIM = 'rgba(252, 255, 0, 0.28)'
const LIME_FAINT = 'rgba(252, 255, 0, 0.12)'
const INK = '#05060a'
const PLATE = '#08090f'
const STUB = '#0b0c07'
const MUTED = '#8b8f9a'
const SOFT = '#c4c7cf'
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

function Corner({ x, y }: { x: 'left' | 'right'; y: 'top' | 'bottom' }) {
  const style: Record<string, string | number> = {
    position: 'absolute',
    width: 22,
    height: 22,
    display: 'flex'
  }
  if (y === 'top') {
    style.top = 16
    style.borderTop = `2px solid ${LIME}`
  } else {
    style.bottom = 16
    style.borderBottom = `2px solid ${LIME}`
  }
  if (x === 'left') {
    style.left = 16
    style.borderLeft = `2px solid ${LIME}`
  } else {
    style.right = 16
    style.borderRight = `2px solid ${LIME}`
  }
  return <div style={style} />
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
        width: 58,
        height: 68,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        border: `2px solid ${LIME_DIM}`,
        backgroundColor: 'rgba(252, 255, 0, 0.06)',
        fontSize: 24,
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
  const cells = inviteKeyCells(normalized)
  const serial = cells ? `${cells.slice(0, 4).join('')}-${cells.slice(4).join('')}` : normalized
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
          position: 'relative',
          backgroundColor: INK,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: 'flex',
            backgroundImage:
              'linear-gradient(rgba(252, 255, 0, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(252, 255, 0, 0.035) 1px, transparent 1px)',
            backgroundSize: '48px 48px'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: -180,
            left: -80,
            width: 820,
            height: 720,
            display: 'flex',
            background:
              'radial-gradient(circle, rgba(252, 255, 0, 0.13) 0%, rgba(252, 255, 0, 0) 68%)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -60,
            bottom: -160,
            width: 520,
            height: 520,
            display: 'flex',
            background:
              'radial-gradient(circle, rgba(252, 255, 0, 0.08) 0%, rgba(252, 255, 0, 0) 70%)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 110,
            top: 86,
            width: 980,
            height: 980,
            display: 'flex',
            borderRadius: 999,
            border: '1px dashed rgba(252, 255, 0, 0.1)'
          }}
        />

        <div
          style={{
            position: 'relative',
            margin: 28,
            width: 1144,
            height: 574,
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
            borderRadius: 22,
            backgroundColor: PLATE,
            backgroundImage:
              'linear-gradient(180deg, rgba(252, 255, 0, 0.07), rgba(252, 255, 0, 0.015) 42%, transparent 70%)',
            border: `1px solid ${LIME_FAINT}`
          }}
        >
          <Corner x="left" y="top" />
          <Corner x="right" y="top" />
          <Corner x="left" y="bottom" />
          <Corner x="right" y="bottom" />

          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 220,
              width: 160,
              height: 574,
              display: 'flex',
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.045) 50%, transparent)'
            }}
          />

          <div
            style={{
              width: 868,
              height: 574,
              display: 'flex',
              flexDirection: 'column',
              paddingTop: 34,
              paddingBottom: 28,
              paddingLeft: 44,
              paddingRight: 36
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: LIME,
                    display: 'flex'
                  }}
                />
                <div
                  style={{
                    marginLeft: 12,
                    fontSize: 16,
                    letterSpacing: 7,
                    color: MUTED,
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
                  <img src={markSrc} width={34} height={34} alt="" />
                ) : null}
                <div
                  style={{
                    marginLeft: 10,
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

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: 34
              }}
            >
              <div
                style={{
                  fontSize: 52,
                  lineHeight: 1.15,
                  color: LIME,
                  textShadow: '0 0 26px rgba(252, 255, 0, 0.45)',
                  display: 'flex',
                  ...pixelFamily
                }}
              >
                {"YOU'RE"}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 52,
                  lineHeight: 1.15,
                  color: LIME,
                  textShadow: '0 0 26px rgba(252, 255, 0, 0.45)',
                  display: 'flex',
                  ...pixelFamily
                }}
              >
                INVITED
              </div>
              <div
                style={{
                  marginTop: 18,
                  fontSize: 20,
                  color: SOFT,
                  display: 'flex',
                  ...monoFamily
                }}
              >
                this key skips the gate — the board is open
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: 32
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
                PERSONAL ACCESS CODE
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: 12
                }}
              >
                <div
                  style={{
                    height: 68,
                    paddingLeft: 14,
                    paddingRight: 14,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 10,
                    border: '2px solid rgba(255,255,255,0.1)',
                    backgroundColor: 'rgba(0,0,0,0.28)',
                    fontSize: 16,
                    letterSpacing: 3,
                    color: MUTED,
                    ...monoFamily
                  }}
                >
                  CRIB
                </div>
                {cells ? (
                  <div style={{ display: 'flex', alignItems: 'center', marginLeft: 10 }}>
                    {cells.slice(0, 4).map((char, i) => (
                      <div key={`a-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : 7 }}>
                        <KeyCell char={char} pixelFamily={pixelFamily} />
                      </div>
                    ))}
                    <div
                      style={{
                        width: 14,
                        height: 2,
                        marginLeft: 8,
                        marginRight: 8,
                        backgroundColor: 'rgba(252, 255, 0, 0.35)',
                        display: 'flex'
                      }}
                    />
                    {cells.slice(4).map((char, i) => (
                      <div key={`b-${i}`} style={{ display: 'flex', marginLeft: i === 0 ? 0 : 7 }}>
                        <KeyCell char={char} pixelFamily={pixelFamily} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      marginLeft: 10,
                      height: 68,
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

            <div style={{ display: 'flex', flexGrow: 1, width: '100%' }} />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                marginTop: 18
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  letterSpacing: 6,
                  color: '#5c606a',
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
                  color: '#5c606a',
                  display: 'flex',
                  ...monoFamily
                }}
              >
                {'// no bots beyond this point'}
              </div>
            </div>
          </div>

          <div
            style={{
              width: 28,
              height: 574,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
              paddingBottom: 12
            }}
          >
            {Array.from({ length: 13 }, (_, i) => (
              <div
                key={`hole-${i}`}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  backgroundColor: INK,
                  border: `1px solid ${LIME_FAINT}`,
                  display: 'flex'
                }}
              />
            ))}
          </div>

          <div
            style={{
              width: 248,
              height: 574,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: STUB,
              backgroundImage:
                'linear-gradient(180deg, rgba(252, 255, 0, 0.1), rgba(252, 255, 0, 0.02) 55%, transparent)'
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
                marginTop: 28,
                fontSize: 28,
                color: LIME,
                textShadow: '0 0 20px rgba(252, 255, 0, 0.4)',
                display: 'flex',
                ...pixelFamily
              }}
            >
              +1,500
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                letterSpacing: 3,
                color: MUTED,
                display: 'flex',
                ...monoFamily
              }}
            >
              PTS PER RECRUIT
            </div>
            <div
              style={{
                width: 72,
                height: 1,
                marginTop: 28,
                marginBottom: 28,
                backgroundColor: LIME_DIM,
                display: 'flex'
              }}
            />
            <div
              style={{
                fontSize: 14,
                letterSpacing: 3,
                color: LIME,
                display: 'flex',
                ...monoFamily
              }}
            >
              SKIP THE GATE
            </div>
            <div
              style={{
                marginTop: 22,
                fontSize: 13,
                letterSpacing: 2,
                color: '#5c606a',
                display: 'flex',
                ...monoFamily
              }}
            >
              {serial ? `NO. ${serial}` : 'NO. ———'}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                marginTop: 20
              }}
            >
              {[5, 12, 7, 14, 6, 11, 4, 13, 8, 5, 12, 7, 10, 6].map((h, i) => (
                <div
                  key={`bar-${i}`}
                  style={{
                    width: 3,
                    height: h,
                    marginLeft: i === 0 ? 0 : 3,
                    backgroundColor: 'rgba(252, 255, 0, 0.42)',
                    display: 'flex'
                  }}
                />
              ))}
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
