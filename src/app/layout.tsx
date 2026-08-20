import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Instrument_Serif, Inter, Noto_Sans_Arabic, Noto_Sans_JP, Noto_Sans_KR, Noto_Sans_SC, Press_Start_2P, Roboto, Space_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { NAV_BOOT_SCRIPT } from '@/components/nav/navBoot'
import { resolveShareOrigin } from '@/lib/appUrl'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// Editorial display serif — hero tagline + the rotating "worldwide" word.
// Single weight; the italic is the whole point.
const instrumentSerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-serif-display',
  display: 'swap',
  // Only styles landing/login/welcome/privacy/error heroes — skip the
  // eager preload on every app page; it still loads on use.
  preload: false,
})

// International fonts — only the landing hero's rotating "worldwide"
// word (WorldwideText) uses these; loaded on demand, never preloaded.
const notoArabic = Noto_Sans_Arabic({ 
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
  preload: false,
})

const notoJapanese = Noto_Sans_JP({ 
  subsets: ['latin'],
  variable: '--font-japanese',
  display: 'swap',
  preload: false,
})

const notoKorean = Noto_Sans_KR({ 
  subsets: ['latin'],
  variable: '--font-korean',
  display: 'swap',
  preload: false,
})

const notoChinese = Noto_Sans_SC({ 
  subsets: ['latin'],
  variable: '--font-chinese',
  display: 'swap',
  preload: false,
})

// Retro pixel font for arcade-style stat readouts
const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
})

// Geometric display sans for competitive surfaces (leaderboard names,
// headers, big numerals) — sharper than mono, still space-age.
const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

// Instrument data mono — dashboard microlabels, dotted leaders, and
// annotation readouts (sharper than the system mono stack).
const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-data',
  display: 'swap',
})

// Same deal as the Notos: WorldwideText's Latin/Cyrillic/Greek variants
// are its only consumer. Regular only — the rotator never asks for
// 500/700, and those extra files are what flake `next/font` fetches
// against fonts.gstatic.com on Vercel (BUILD_UTILS_SPAWN_1).
const roboto = Roboto({
  weight: '400',
  subsets: ['latin', 'cyrillic', 'greek', 'latin-ext'],
  variable: '--font-international',
  display: 'swap',
  preload: false,
})

// Mobile browser chrome: tint the URL bar / status area to match the
// deep-space backdrop instead of default white, and let the page extend
// into the safe areas on notched phones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#05060a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

export const metadata: Metadata = {
  // Canonical share origin so relative OG/twitter image URLs (e.g. the
  // /join/[code] invite card) resolve to absolute https://cribble.dev links.
  metadataBase: new URL(resolveShareOrigin()),
  title: 'Cribble - AI Usage Leaderboard for Developers',
  description: 'Discover your rank among AI-powered developers globally.',
  icons: {
    icon: [
      {
        url: '/favicon.ico',
        sizes: 'any',
      },
      {
        url: '/favicon.png',
        type: 'image/png',
        sizes: '256x256',
      },
    ],
    apple: '/apple-icon.png',
    shortcut: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${instrumentSerif.variable} ${notoArabic.variable} ${notoJapanese.variable} ${notoKorean.variable} ${notoChinese.variable} ${roboto.variable} ${pressStart.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}>
        {/* Seeds nav position/expansion attributes on <html> before first
            paint so the app shell inset renders correctly with no flash. */}
        <script dangerouslySetInnerHTML={{ __html: NAV_BOOT_SCRIPT }} />
        <ThemeProvider>
          {children}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}