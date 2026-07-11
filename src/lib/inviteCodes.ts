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
