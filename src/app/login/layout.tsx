import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in — cribble',
  description: 'Sign in to cribble with GitHub. New accounts require a beta invite code.',
  robots: { index: false }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
