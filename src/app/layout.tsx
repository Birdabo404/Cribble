import type { Metadata, Viewport } from 'next'
import { Instrument_Serif, Inter, Noto_Sans_Arabic, Noto_Sans_JP, Noto_Sans_KR, Noto_Sans_SC, Press_Start_2P, Roboto, Space_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { NAV_BOOT_SCRIPT } from '@/components/nav/navBoot'
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
})

// International fonts
const notoArabic = Noto_Sans_Arabic({ 
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
})

const notoJapanese = Noto_Sans_JP({ 
  subsets: ['latin'],
  variable: '--font-japanese',
  display: 'swap',
})

const notoKorean = Noto_Sans_KR({ 
  subsets: ['latin'],
  variable: '--font-korean',
  display: 'swap',
})

const notoChinese = Noto_Sans_SC({ 
  subsets: ['latin'],
  variable: '--font-chinese',
  display: 'swap',
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

const roboto = Roboto({ 
  weight: ['400', '500', '700'],
  subsets: ['latin', 'cyrillic', 'greek', 'latin-ext'],
  variable: '--font-international',
  display: 'swap',
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
      <body className={`${inter.className} ${instrumentSerif.variable} ${notoArabic.variable} ${notoJapanese.variable} ${notoKorean.variable} ${notoChinese.variable} ${roboto.variable} ${pressStart.variable} ${spaceGrotesk.variable}`}>
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