import { describe, expect, it } from 'vitest'
import { tabsFor, type TabsForInput } from './tabsFor'

// The list this returns is what ProfileMenu renders AND what a #hash is
// allowed to resolve to, so the presence rules and the order are pinned
// here rather than read off the JSX.

const base: TabsForInput = { hangarCount: 0, isYou: false, hasAffiliates: false }

describe('tabsFor', () => {
  it('visitor on an empty hangar sees the three core panes', () => {
    expect(tabsFor(base)).toEqual(['record', 'loadout', 'service-record'])
  })

  it('RECORD is always first', () => {
    expect(tabsFor(base)[0]).toBe('record')
    expect(tabsFor({ hangarCount: 6, isYou: true, hasAffiliates: true })[0]).toBe('record')
  })

  describe('HANGAR', () => {
    it('appears for a visitor once something is docked', () => {
      expect(tabsFor({ ...base, hangarCount: 1 })).toContain('hangar')
    })

    it('always appears for the owner, even with nothing docked', () => {
      expect(tabsFor({ ...base, isYou: true })).toContain('hangar')
    })

    it('never shows a visitor an empty tab', () => {
      expect(tabsFor({ ...base, hangarCount: 0 })).not.toContain('hangar')
    })

    it('sits between RECORD and LOADOUT', () => {
      expect(tabsFor({ ...base, hangarCount: 2 })).toEqual([
        'record',
        'hangar',
        'loadout',
        'service-record'
      ])
    })
  })

  describe('AFFILIATES', () => {
    it('is present only when the payload attached a roster', () => {
      expect(tabsFor({ ...base, hasAffiliates: true })).toContain('affiliates')
      expect(tabsFor(base)).not.toContain('affiliates')
    })

    it('is always last', () => {
      const tabs = tabsFor({ hangarCount: 3, isYou: true, hasAffiliates: true })
      expect(tabs[tabs.length - 1]).toBe('affiliates')
    })
  })

  it('full order with everything present', () => {
    expect(tabsFor({ hangarCount: 3, isYou: true, hasAffiliates: true })).toEqual([
      'record',
      'hangar',
      'loadout',
      'service-record',
      'affiliates'
    ])
  })

  it('never repeats an id', () => {
    const inputs: TabsForInput[] = [
      base,
      { hangarCount: 1, isYou: true, hasAffiliates: false },
      { hangarCount: 0, isYou: true, hasAffiliates: true },
      { hangarCount: 6, isYou: false, hasAffiliates: true }
    ]
    for (const input of inputs) {
      const tabs = tabsFor(input)
      expect(new Set(tabs).size).toBe(tabs.length)
    }
  })
})
