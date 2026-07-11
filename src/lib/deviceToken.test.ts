import { describe, expect, it } from 'vitest'
import {
  generateDeviceSyncToken,
  hashDeviceSyncToken,
  verifyDeviceSyncToken
} from './deviceToken'

describe('deviceToken', () => {
  it('generates 64-char hex tokens with fresh entropy each call', () => {
    const a = generateDeviceSyncToken()
    const b = generateDeviceSyncToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('verifies a token against its own hash', () => {
    const token = generateDeviceSyncToken()
    const hash = hashDeviceSyncToken(token)
    expect(verifyDeviceSyncToken(token, hash)).toBe(true)
  })

  it('rejects a wrong token', () => {
    const hash = hashDeviceSyncToken(generateDeviceSyncToken())
    expect(verifyDeviceSyncToken(generateDeviceSyncToken(), hash)).toBe(false)
  })

  it('rejects missing token or missing stored hash', () => {
    const token = generateDeviceSyncToken()
    expect(verifyDeviceSyncToken(null, hashDeviceSyncToken(token))).toBe(false)
    expect(verifyDeviceSyncToken(undefined, hashDeviceSyncToken(token))).toBe(false)
    expect(verifyDeviceSyncToken('', hashDeviceSyncToken(token))).toBe(false)
    expect(verifyDeviceSyncToken(token, null)).toBe(false)
    expect(verifyDeviceSyncToken(token, undefined)).toBe(false)
    expect(verifyDeviceSyncToken(token, '')).toBe(false)
  })

  it('rejects malformed stored hashes without throwing', () => {
    const token = generateDeviceSyncToken()
    expect(verifyDeviceSyncToken(token, 'not-hex')).toBe(false)
    expect(verifyDeviceSyncToken(token, 'abcd')).toBe(false)
  })
})
