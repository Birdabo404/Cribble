const TRUE_LIKE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function normalizeFlag(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

export function isSiteLocked(): boolean {
  // `SITE_LOCKED` is server-only and should be treated as source-of-truth.
  // We keep `NEXT_PUBLIC_SITE_LOCKED` as a fallback for compatibility.
  const serverFlag = normalizeFlag(process.env.SITE_LOCKED)
  if (serverFlag) {
    return TRUE_LIKE_VALUES.has(serverFlag)
  }

  const publicFlag = normalizeFlag(process.env.NEXT_PUBLIC_SITE_LOCKED)
  return TRUE_LIKE_VALUES.has(publicFlag)
}

export function isAllowedDuringLock(pathname: string): boolean {
  if (pathname === '/') return true
  if (pathname === '/welcome' || pathname === '/login') return true
  if (pathname.startsWith('/audio/')) return true
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true
  if (pathname === '/leaderboard' || pathname.startsWith('/leaderboard/')) return true
  if (/^\/api\/waitlist\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/auth/')) return true
  if (/^\/api\/user\/(onboarding|me|tools|activity)\/?$/.test(pathname)) return true
  if (/^\/api\/leaderboard\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/extension/')) return true
  return false
}
