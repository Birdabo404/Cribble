// Display-name ownership challenge for claimed cursor.com profiles.
// Claiming (migration 062) is trust-based — first come, first served.
// Verification proves the claim: the user puts a short CRIB-XXXX code
// in their cursor.com display name, one scrape (fetchCursorProfile
// already returns displayName) confirms it, and the code comes back
// out. Codes have no expiry — a code is only useful inside the real
// owner's own display name, so a stale one grants nothing.
//
// Pure and network-free; the verify route owns the fetch and the DB
// writes (cursor_profiles.verified_at / verify_code, migration 067).

import { randomInt } from 'node:crypto'

/** 2-9 + A-Z minus the lookalikes 0/O and 1/I — every glyph reads back
 *  unambiguously off a profile page. */
const VERIFY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const VERIFY_CODE_LENGTH = 4

/** What a well-formed challenge code looks like — mirrored by the
 *  cursor_profiles_verify_code_format CHECK in migration 067. */
export const CURSOR_VERIFY_CODE_PATTERN = /^CRIB-[2-9A-HJ-NP-Z]{4}$/

/** Mints a fresh CRIB-XXXX challenge code (CSPRNG, unbiased). */
export function generateCursorVerifyCode(): string {
  let suffix = ''
  for (let i = 0; i < VERIFY_CODE_LENGTH; i++) {
    suffix += VERIFY_CODE_ALPHABET[randomInt(VERIFY_CODE_ALPHABET.length)]
  }
  return `CRIB-${suffix}`
}

/**
 * Whether a scraped display name carries the challenge code. Case-
 * insensitive contains — the code is unambiguous uppercase, but profile
 * editors love to re-case pasted text. A malformed stored code never
 * matches: an empty string would otherwise "contain" into everything
 * and auto-verify the world.
 */
export function displayNameHasVerifyCode(
  displayName: string | null,
  code: string
): boolean {
  if (displayName === null || !CURSOR_VERIFY_CODE_PATTERN.test(code)) return false
  return displayName.toUpperCase().includes(code)
}
