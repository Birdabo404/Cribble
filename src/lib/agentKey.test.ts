import { describe, expect, it } from 'vitest'
import {
  AGENT_API_KEY_PREFIX,
  generateAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
  verifyAgentApiKey
} from './agentKey'

describe('agentKey', () => {
  it('generates prefixed keys with 32 bytes of fresh entropy', () => {
    const first = generateAgentApiKey()
    const second = generateAgentApiKey()

    expect(first).toMatch(/^crib_ag_[0-9a-f]{64}$/)
    expect(second).toMatch(/^crib_ag_[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
  })

  it('hashes and verifies a generated key', () => {
    const key = generateAgentApiKey()
    const hash = hashAgentApiKey(key)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyAgentApiKey(key, hash)).toBe(true)
  })

  it('rejects a wrong or empty key', () => {
    const key = generateAgentApiKey()
    const hash = hashAgentApiKey(key)

    expect(verifyAgentApiKey(generateAgentApiKey(), hash)).toBe(false)
    expect(verifyAgentApiKey('', hash)).toBe(false)
    expect(verifyAgentApiKey(null, hash)).toBe(false)
    expect(verifyAgentApiKey(undefined, hash)).toBe(false)
  })

  it('rejects missing or malformed stored hashes without throwing', () => {
    const key = generateAgentApiKey()

    expect(verifyAgentApiKey(key, '')).toBe(false)
    expect(verifyAgentApiKey(key, null)).toBe(false)
    expect(verifyAgentApiKey(key, undefined)).toBe(false)
    expect(verifyAgentApiKey(key, 'not-hex')).toBe(false)
    expect(verifyAgentApiKey(key, 'abcd')).toBe(false)
  })

  it('derives the non-secret display prefix', () => {
    const prefix = getAgentApiKeyPrefix(generateAgentApiKey())

    expect(AGENT_API_KEY_PREFIX).toBe('crib_ag_')
    expect(prefix).toMatch(/^crib_ag_[0-9a-f]{4}$/)
    expect(prefix).toHaveLength(12)
  })
})
