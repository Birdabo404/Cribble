// Share links are /join/CODE. People type the code in caps and often
// uppercase the whole path (/JOIN/CRIB-…) — Next.js and the site-lock
// allowlist are case-sensitive, so that used to miss /join/[code] and
// land on the maintenance rewrite. Kept out of inviteCodes.ts so Edge
// middleware can import this without Node `crypto`.

const JOIN_PREFIX = /^\/join(?=\/|$)/i

export function isJoinInvitePath(pathname: string): boolean {
  return JOIN_PREFIX.test(pathname)
}

/** Lowercase-`/join` form, or null when the path is already canonical / not a join URL. */
export function canonicalizeJoinPathname(pathname: string): string | null {
  const match = pathname.match(JOIN_PREFIX)
  if (!match) return null
  const canonical = `/join${pathname.slice(match[0].length)}`
  return canonical === pathname ? null : canonical
}
