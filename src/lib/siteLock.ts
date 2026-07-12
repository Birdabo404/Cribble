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

// Static assets served from /public that pages need even while locked
// (e.g. the /login artwork, logos, badges). Matched by file extension so the
// Next image optimizer's internal fetch of the source file also succeeds.
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|webm|woff2?)$/i

export function isAllowedDuringLock(pathname: string): boolean {
  if (pathname === '/') return true
  if (pathname === '/welcome' || pathname === '/login') return true
  if (pathname.startsWith('/audio/')) return true
  if (!pathname.startsWith('/api/') && STATIC_ASSET_RE.test(pathname)) return true
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true
  if (pathname.startsWith('/api/admin/')) return true
  if (pathname === '/leaderboard' || pathname.startsWith('/leaderboard/')) return true
  // Public pilot dossiers (+ the /profile redirect into your own).
  if (pathname === '/profile' || pathname.startsWith('/u/')) return true
  if (/^\/api\/waitlist\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/auth/')) return true
  if (/^\/api\/user\/(onboarding|me|tools|activity|follow|profile|achievements|notifications)\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/profile/')) return true
  if (pathname === '/api/leaderboard' || pathname.startsWith('/api/leaderboard/')) return true
  if (pathname.startsWith('/api/extension/')) return true
  // Extension reconcile polling (GET /api/device/verify) must keep working
  // while the site is locked, same as the /api/extension/* sync path.
  if (pathname.startsWith('/api/device/')) return true
  return false
}
