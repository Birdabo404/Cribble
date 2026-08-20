import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { normalizeInviteCode } from '@/lib/inviteCodes'

// Share card for /join/CODE — the unfurl crawlers actually render.
// Deep-space backdrop + electric lime, matching the referral plate the
// link was minted from. ImageResponse JSX cannot read CSS variables, so
// the lime is the literal value of --ref-lime (252 255 0) in globals.css.

export const alt = "You're Invited! Join Cribble, the AI coding leaderboard."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const LIME = 'rgb(252, 255, 0)'
const MARK_PATH = path.join(process.cwd(), 'public/brand/cribble-mark.png')
// Vendored from Google Fonts (both OFL): the brand pixel font for the
// headline/code and the house mono for supporting copy — satori drops its
// built-in fallback font as soon as custom fonts are supplied.
const PIXEL_FONT_PATH = path.join(process.cwd(), 'src/app/join/[code]/press-start-2p.ttf')
const MONO_FONT_PATH = path.join(process.cwd(), 'src/app/join/[code]/ibm-plex-mono-500.ttf')

/** The card must never 500 over an asset: missing files degrade instead. */
async function loadOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export default async function OpengraphImage({
  params
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const normalized = normalizeInviteCode(code || '')
  const [pixelFont, monoFont, mark] = await Promise.all([
    loadOptional(PIXEL_FONT_PATH),
    loadOptional(MONO_FONT_PATH),
    loadOptional(MARK_PATH)
  ])
  const markSrc = mark ? `data:image/png;base64,${mark.toString('base64')}` : null

  const fonts = []
  if (pixelFont) {
    fonts.push({ name: 'PressStart2P', data: pixelFont, style: 'normal' as const, weight: 400 as const })
  }
  if (monoFont) {
    fonts.push({ name: 'PlexMono', data: monoFont, style: 'normal' as const, weight: 500 as const })
  }

  // Fallbacks keep the card legible if a font goes missing: the headline
  // borrows heavy default type, mono text falls to whatever loaded first.
  const pixelFamily = pixelFont
    ? { fontFamily: 'PressStart2P' }
    : { fontWeight: 900, letterSpacing: 4 }
  const monoFamily = monoFont ? { fontFamily: 'PlexMono' } : {}

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          backgroundColor: '#05060a',
          backgroundImage:
            'linear-gradient(rgba(252, 255, 0, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(252, 255, 0, 0.045) 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }}
      >
        {/* lime bloom behind the mark + headline */}
        <div
          style={{
            position: 'absolute',
            top: -140,
            left: 240,
            width: 720,
            height: 620,
            display: 'flex',
            background:
              'radial-gradient(circle, rgba(252, 255, 0, 0.11) 0%, rgba(252, 255, 0, 0) 65%)'
          }}
        />

        {markSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={markSrc} width={144} height={144} alt="" />
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 26
          }}
        >
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
              fontSize: 21,
              letterSpacing: 10,
              color: '#8b8f9a',
              display: 'flex',
              ...monoFamily
            }}
          >
            PERSONAL INVITE
          </div>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: LIME,
              display: 'flex'
            }}
          />
        </div>

        <div
          style={{
            marginTop: 30,
            fontSize: 56,
            color: LIME,
            textShadow: '0 0 28px rgba(252, 255, 0, 0.4)',
            display: 'flex',
            ...pixelFamily
          }}
        >
          {"YOU'RE INVITED!"}
        </div>

        <div
          style={{
            marginTop: 26,
            fontSize: 25,
            color: '#b4b8c2',
            display: 'flex',
            ...monoFamily
          }}
        >
          Join the AI coding leaderboard — this invite skips the gate
        </div>

        {normalized && (
          <div
            style={{
              marginTop: 36,
              display: 'flex',
              alignItems: 'center',
              padding: '20px 36px',
              borderRadius: 16,
              border: '2px solid rgba(252, 255, 0, 0.35)',
              backgroundColor: 'rgba(252, 255, 0, 0.06)',
              fontSize: 28,
              color: LIME,
              ...pixelFamily
            }}
          >
            {normalized}
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            bottom: 34,
            fontSize: 19,
            letterSpacing: 9,
            color: '#63666f',
            display: 'flex',
            ...monoFamily
          }}
        >
          CRIBBLE.DEV
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length > 0 ? fonts : undefined
    }
  )
}
