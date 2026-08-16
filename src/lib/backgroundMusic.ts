// Background music for the authenticated app shell: track catalog,
// device-local preference keys (localStorage only — never server-synced),
// and the route allowlist deciding where music plays. Consumed by
// BackgroundMusicProvider and the Appearance → Sound settings section.
//
// Deliberately separate from the welcome-page ambience
// (deeper-into-it.mp3), which keeps its own element and volume.

// Yellow leads the playlist; playback wraps forever from the last track
// back to the first (Yellow → Mellow → Yellow → …).
export const BACKGROUND_TRACKS = [
  { id: 'yellow', title: 'Cribble Yellow', src: '/audio/Cribble-Yellow.mp3' },
  { id: 'mellow', title: 'Cribble Mellow', src: '/audio/Cribble-Mellow.mp3' }
] as const

export type BackgroundTrack = (typeof BACKGROUND_TRACKS)[number]

export const MUSIC_VOLUME_KEY = 'cribble.music.volume' // 0–1 float string
export const MUSIC_MUTED_KEY = 'cribble.music.muted' // '1' | '0'
export const DEFAULT_MUSIC_VOLUME = 0.4

export const MUSIC_PLAY_ROUTES = [
  '/dashboard',
  '/bag',
  '/shop',
  '/profile' // redirects to /u/[username]
] as const

/**
 * The four main surfaces get music; everything else (leaderboard, team,
 * settings, marketing, login, welcome) stays silent. Dashboard includes
 * its subroutes (e.g. /dashboard/achievements) so music does not cut out
 * inside the section; profile is /profile plus its /u/[username] target.
 */
export function isMusicPlayPath(pathname: string): boolean {
  if (pathname === '/profile' || pathname.startsWith('/u/')) return true
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true
  return pathname === '/bag' || pathname === '/shop'
}

/** Playlist advance with wrap — shared by the ended handler and skip. */
export function nextTrackIndex(index: number): number {
  return (index + 1) % BACKGROUND_TRACKS.length
}

export function clampMusicVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MUSIC_VOLUME
  return Math.min(1, Math.max(0, value))
}

/** Raw localStorage value → volume, tolerating missing/garbage entries. */
export function parseStoredVolume(raw: string | null): number {
  // Number('') and Number('   ') coerce to 0, which would read as
  // "silent" rather than "unset" — treat blank the same as missing.
  if (raw === null || raw.trim() === '') return DEFAULT_MUSIC_VOLUME
  return clampMusicVolume(Number(raw))
}

/** Raw localStorage value → muted flag; anything but '1' means audible. */
export function parseStoredMuted(raw: string | null): boolean {
  return raw === '1'
}
