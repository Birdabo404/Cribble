import { createHash, randomBytes, timingSafeEqual } from 'crypto'

// Personal access key for the agent CLI. The full plaintext is returned
// exactly once when minted; only its SHA-256 digest is stored. The fixed
// prefix makes accidentally exposed keys easy to identify and revoke.

export const AGENT_API_KEY_PREFIX = 'crib_ag_'
export const AGENT_API_KEY_DISPLAY_LENGTH = 12

export function generateAgentApiKey(): string {
  return `${AGENT_API_KEY_PREFIX}${randomBytes(32).toString('hex')}`
}

export function hashAgentApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

export function getAgentApiKeyPrefix(key: string): string {
  return key.slice(0, AGENT_API_KEY_DISPLAY_LENGTH)
}

export function verifyAgentApiKey(
  key: string | null | undefined,
  storedHash: string | null | undefined
): boolean {
  if (!key || !storedHash) return false
  const candidate = Buffer.from(hashAgentApiKey(key), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}
