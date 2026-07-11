import type { Metadata } from 'next'
import { Inter, Noto_Sans_Arabic, Noto_Sans_JP, Noto_Sans_KR, Noto_Sans_SC, Press_Start_2P, Roboto } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

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

const roboto = Roboto({ 
  weight: ['400', '500', '700'],
  subsets: ['latin', 'cyrillic', 'greek', 'latin-ext'],
  variable: '--font-international',
  display: 'swap',
})

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
        sizes: 'any',
      },
    ],
    apple: '/favicon.png',
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
      <body className={`${inter.className} ${notoArabic.variable} ${notoJapanese.variable} ${notoKorean.variable} ${notoChinese.variable} ${roboto.variable} ${pressStart.variable}`}>
        <ThemeProvider>
          {children}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}