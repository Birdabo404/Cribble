import crypto from 'crypto'

// No 0/O/1/I/L to keep codes easy to read aloud and retype.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomSegment(length: number): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (const byte of bytes) {
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return out
}

export function generateInviteCode(): string {
  return `CRIB-${randomSegment(4)}-${randomSegment(4)}`
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase()
}

const INVITE_SHAPE = /^CRIB-([A-Z0-9]{4})-([A-Z0-9]{4})$/

/** Eight payload characters for the login-style CRIB-····-···· cells. */
export function inviteKeyCells(code: string): string[] | null {
  const match = normalizeInviteCode(code).match(INVITE_SHAPE)
  if (!match) return null
  return [...match[1], ...match[2]]
}
