import { isJoinInvitePath } from './joinPath'

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
// (e.g. the /login artwork, logos, badges, and the landing globe's geometry
// and models). Matched by file extension so the Next image optimizer's
// internal fetch of the source file also succeeds.
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|webm|woff2?|geojson|glb)$/i

export function isAllowedDuringLock(pathname: string, hasSession = false): boolean {
  if (pathname === '/') return true
  if (pathname === '/welcome' || pathname === '/login') return true
  // The screens locked sectors rewrite into — must stay reachable
  // themselves: /maintenance for sealed sectors, /restricted for
  // session-gated ones (the sign-in wall).
  if (pathname === '/maintenance') return true
  if (pathname === '/restricted') return true
  // Privacy policy is the Chrome Web Store listing's privacy URL and must
  // stay reachable while the site is locked.
  if (pathname === '/privacy') return true
  // The status observatory is public on purpose — it must answer exactly
  // when things look broken. Exact match on the API lane so nothing else
  // under /api/status… rides along (/api/device/status keeps its own
  // /api/device/ rule below).
  if (pathname === '/status') return true
  if (pathname === '/api/status') return true
  // Leaderboard visitor ticker (first-party pulse + heartbeat). Exact
  // match so nothing else under /api/analytics… rides along.
  if (pathname === '/api/analytics/visitors') return true
  if (pathname === '/api/analytics/hit') return true
  // Referral share links redirect into /login and must work while locked.
  // Case-insensitive: /JOIN/CODE is a common mistype of the uppercase key.
  if (isJoinInvitePath(pathname)) return true
  if (pathname.startsWith('/audio/')) return true
  if (!pathname.startsWith('/api/') && STATIC_ASSET_RE.test(pathname)) return true
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true
  // Settings hub and bag are signed-in only while locked (same
  // session-presence gate as /shop). Billboard APIs stay open below —
  // the ticker/rails mount on allowlisted shell pages.
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return hasSession
  if (pathname === '/bag' || pathname.startsWith('/bag/')) return hasSession
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true
  if (pathname.startsWith('/api/admin/')) return true
  if (pathname === '/leaderboard' || pathname.startsWith('/leaderboard/')) return true
  // Public pilot profiles (+ the /profile redirect into your own).
  if (pathname === '/profile' || pathname.startsWith('/u/')) return true
  // Live placements for the ticker + rails (pages above are session-gated).
  if (pathname.startsWith('/api/billboard')) return true
  if (/^\/api\/waitlist\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/auth/')) return true
  // Season calendar backs the dashboard rail + leaderboard countdown, and
  // the cron backup trigger must stay reachable while locked.
  if (pathname === '/api/season') return true
  if (pathname === '/api/cron/season') return true
  if (pathname === '/api/cron/insights-rollup') return true
  if (pathname === '/api/cron/leaderboard-integrity') return true
  // Dashboard/settings reads, agent key management, and delete ride the
  // signed-in app shell; cosmetics stays on its own lane below with the
  // shop/billing paths. Keep this exact so similarly prefixed user routes
  // do not bypass the private-beta lock.
  if (/^\/api\/user\/(onboarding|me|tools|activity|follow|profile|achievements|notifications|referral|settings|agent-keys|agent-sharing|token-usage|delete)\/?$/.test(pathname)) return true
  // Agent token ingest is one exact API lane. Do not open the rest of the
  // /api/agent namespace while the private-beta lock is active.
  if (/^\/api\/agent\/usage\/?$/.test(pathname)) return true
  // Beta feedback comes from testers inside the locked app shell.
  if (/^\/api\/feedback\/?$/.test(pathname)) return true
  if (pathname.startsWith('/api/profile/')) return true
  if (pathname === '/api/leaderboard' || pathname.startsWith('/api/leaderboard/')) return true
  if (pathname.startsWith('/api/extension/')) return true
  // Extension reconcile polling (GET /api/device/verify) must keep working
  // while the site is locked, same as the /api/extension/* sync path.
  if (pathname.startsWith('/api/device/')) return true
  // Payments must survive a site lock: Polar webhook deliveries, checkout
  // creation, the billing portal, and the shop page checkout bounces land
  // on — plus the cosmetics read and the entitlement sync the shop calls.
  if (pathname === '/api/webhooks/polar') return true
  if (pathname === '/api/checkout') return true
  if (pathname === '/api/portal') return true
  if (pathname === '/api/user/cosmetics') return true
  if (pathname === '/api/user/subscription/sync') return true
  // The storefront is for signed-in pilots only while the site is locked.
  // Cookie presence is the strongest signal the middleware can afford —
  // validating the token would cost a database round trip per request —
  // and a forged cookie only reveals the storefront shell: every lane
  // behind it (cosmetics, checkout, portal, sync) enforces real auth.
  if (pathname === '/shop') return hasSession
  // The Cribble Team pitch page is shared with companies while the beta
  // is locked — its checkout/API lanes are already open above.
  if (pathname === '/teams') return true
  // The sponsorship buyer page is the same kind of shareable pitch
  // (/billboard was the old path; keep this public so cribble.dev/sponsorship
  // does not rewrite to /maintenance for signed-out buyers).
  if (pathname === '/sponsorship' || pathname.startsWith('/sponsorship/')) return true
  // The team console is Polar's checkout success URL
  // (/team?checkout=success&checkout_id=...) — a mid-lock Team purchase
  // must land on the live page so the entitlement sync runs, and the
  // roster/invite/membership API lanes back that page. Exact match plus
  // the '/team/' prefix, so nothing else under /te… rides along.
  if (pathname === '/team' || pathname.startsWith('/team/')) return true
  if (pathname.startsWith('/api/team/')) return true
  return false
}

/** Routes deliberately advertised before their implementation is live. */
export function isKnownSealedPage(pathname: string): boolean {
  return pathname === '/roadmap'
}
