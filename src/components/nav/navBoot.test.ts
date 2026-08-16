import { describe, expect, it } from 'vitest'
import {
  NAV_BOOT_SCRIPT,
  NAV_POSITION_DEFAULT,
  resolveNavPosition
} from './navBoot'

describe('resolveNavPosition', () => {
  it('defaults to the left rail when nothing is stored', () => {
    expect(NAV_POSITION_DEFAULT).toBe('left')
    expect(resolveNavPosition(null)).toBe('left')
    expect(resolveNavPosition(undefined)).toBe('left')
    expect(resolveNavPosition('')).toBe('left')
    expect(resolveNavPosition('nope')).toBe('left')
  })

  it('honors an explicit stored position', () => {
    expect(resolveNavPosition('left')).toBe('left')
    expect(resolveNavPosition('top')).toBe('top')
  })
})

describe('NAV_BOOT_SCRIPT', () => {
  it('falls back to the same default as resolveNavPosition', () => {
    expect(NAV_BOOT_SCRIPT).toContain(`p==='left'||p==='top'?p:'${NAV_POSITION_DEFAULT}'`)
  })
})
