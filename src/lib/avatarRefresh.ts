// Stored X avatar URLs rot: pbs.twimg.com keys the file by upload, so a
// user changing their X picture 404s the URL we captured at OAuth login,
// and users.twitter_profile_image only heals at their NEXT login. unavatar
// resolves the *current* avatar by handle, so render layers use it as one
// refresh hop between "stored URL died" and "give up and draw the
// monogram/identicon" — no DB write, and the row self-corrects onscreen.

/** True for avatar URLs subject to X's rot-on-change behavior. GitHub
 *  avatars (avatars.githubusercontent.com) are keyed by user id and don't
 *  rot, so they never take the refresh hop. */
export function isXAvatarUrl(src: string): boolean {
  try {
    return new URL(src).hostname === 'pbs.twimg.com'
  } catch {
    return false
  }
}

const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/

/**
 * Live-avatar URL for an X handle, or null when the string can't be one
 * (GitHub sign-ins reuse the twitter_* columns, so hyphenated GitHub
 * logins and other junk land here too). fallback=false makes unavatar
 * 404 instead of serving its gray placeholder, handing control back to
 * our own fallbacks. CORS is open (`access-control-allow-origin: *`),
 * so canvas samplers like the CRT pixel grid can read it.
 */
export function xAvatarRefreshUrl(handle: string | null | undefined): string | null {
  const trimmed = handle?.trim()
  if (!trimmed || !X_HANDLE.test(trimmed)) return null
  return `https://unavatar.io/x/${trimmed}?fallback=false`
}
