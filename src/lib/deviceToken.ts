import { createHash, randomBytes, timingSafeEqual } from 'crypto'

// Per-device sync token: a bearer secret issued once, over the
// session-authenticated registration path, and required on every ingestion
// request. Only the SHA-256 hash is stored (user_devices.sync_token_hash),
// so a database read cannot recover a usable token.

export const DEVICE_TOKEN_HEADER = 'X-Cribble-Device-Token'

export function generateDeviceSyncToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashDeviceSyncToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function verifyDeviceSyncToken(
  token: string | null | undefined,
  storedHash: string | null | undefined
): boolean {
  if (!token || !storedHash) return false
  const candidate = Buffer.from(hashDeviceSyncToken(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}
