import { describe, expect, it } from 'vitest'
import { resolveEquippedPlate } from './entitlements'

// Catalog fixtures (real launch-catalog ids, stable within the repo):
//   'synthwave-grid' — purchasable, no exclusivity flags
//   'pro-circuit'    — proExclusive, never sold
//   'founder'        — one-run vault drop, owned via a user_cosmetics row
//   'champions-gold' — championExclusive, minted when APEX (#1) unlocks

const resolve = (
  equippedPlateId: unknown,
  tier: string | null,
  owned: string[] | Set<string> = []
) => resolveEquippedPlate({ equippedPlateId, tier, ownedPlateIds: owned })

describe('resolveEquippedPlate', () => {
  it('returns an owned purchasable plate regardless of tier', () => {
    expect(resolve('synthwave-grid', 'FREE', ['synthwave-grid'])).toBe('synthwave-grid')
    expect(resolve('synthwave-grid', null, ['synthwave-grid'])).toBe('synthwave-grid')
  })

  it('accepts ownership as a Set (getOwnedPlateIdsBatch entries)', () => {
    expect(resolve('synthwave-grid', 'FREE', new Set(['synthwave-grid']))).toBe(
      'synthwave-grid'
    )
  })

  it('rejects an unowned purchasable plate even for Pro users', () => {
    expect(resolve('synthwave-grid', 'PRO', [])).toBeNull()
  })

  it('allows pro-exclusive plates while a Pro tier is active, without ownership', () => {
    expect(resolve('pro-circuit', 'PRO', [])).toBe('pro-circuit')
    expect(resolve('pro-circuit', 'pro', [])).toBe('pro-circuit') // case-insensitive
    expect(resolve('pro-circuit', 'PREMIUM', [])).toBe('pro-circuit')
  })

  it('revokes pro-exclusive plates after a downgrade (self-healing read)', () => {
    expect(resolve('pro-circuit', 'FREE', [])).toBeNull()
    expect(resolve('pro-circuit', null, [])).toBeNull()
  })

  it('keeps an owned plate through the ownership path even on FREE tier', () => {
    // e.g. an explicit grant row for a pro plate outlives the subscription
    expect(resolve('pro-circuit', 'FREE', ['pro-circuit'])).toBe('pro-circuit')
  })

  it('founder plate resolves through ownership only (one-run purchase rows)', () => {
    expect(resolve('founder', 'FREE', ['founder'])).toBe('founder')
    expect(resolve('founder', 'PRO', [])).toBeNull() // Pro does not unlock founder
  })

  it('champion plate resolves through ownership only (champion_grant rows)', () => {
    expect(resolve('champions-gold', 'FREE', ['champions-gold'])).toBe('champions-gold')
    expect(resolve('champions-gold', 'PRO', [])).toBeNull() // Pro does not unlock the trophy
  })

  it('rejects ids missing from the catalog even when "owned"', () => {
    expect(resolve('retired-plate', 'PRO', ['retired-plate'])).toBeNull()
  })

  it('rejects non-string / empty equipped values', () => {
    expect(resolve(null, 'PRO', ['synthwave-grid'])).toBeNull()
    expect(resolve(undefined, 'PRO', ['synthwave-grid'])).toBeNull()
    expect(resolve(42, 'PRO', ['synthwave-grid'])).toBeNull()
    expect(resolve('', 'PRO', ['synthwave-grid'])).toBeNull()
    expect(resolve('   ', 'PRO', ['synthwave-grid'])).toBeNull()
  })

  it('trims whitespace around a stored id', () => {
    expect(resolve('  synthwave-grid  ', 'FREE', ['synthwave-grid'])).toBe('synthwave-grid')
  })
})
