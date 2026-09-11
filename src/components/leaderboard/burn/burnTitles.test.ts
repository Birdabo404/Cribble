import { describe, expect, it } from 'vitest'
import { medalFor } from '@/components/leaderboard/types'
import { burnTitle } from './burnTitles'

describe('burnTitle', () => {
  it('crowns the podium in order', () => {
    expect(burnTitle(1)).toBe('THE MONARCH')
    expect(burnTitle(2)).toBe('THE REGENT')
    expect(burnTitle(3)).toBe('THE DUKE')
  })

  it('leaves every rank below the podium to its persona', () => {
    expect(burnTitle(4)).toBeNull()
    expect(burnTitle(25)).toBeNull()
    expect(burnTitle(0)).toBeNull()
    expect(burnTitle(-1)).toBeNull()
  })

  it('has a title exactly where there is a medal', () => {
    for (let rank = 1; rank <= 10; rank++) {
      expect(burnTitle(rank) !== null).toBe(medalFor(rank) !== null)
    }
  })
})
