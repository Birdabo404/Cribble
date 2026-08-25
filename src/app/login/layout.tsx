import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in — cribble',
  description: 'Sign in to cribble with GitHub or X. Invite keys from us or a friend still count.',
  robots: { index: false }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
