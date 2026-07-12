import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in — cribble',
  description: 'Sign in to cribble with GitHub or X. New accounts require a beta invite key.',
  robots: { index: false }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
