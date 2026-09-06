import { describe, expect, it } from 'vitest'
import { designationFor } from './designation'

// The line is decoded on boot and sits under the handle on every device,
// so each segment's exact spelling is pinned here.

describe('designationFor', () => {
  it('formats the full line', () => {
    expect(designationFor({ userId: 26, rank: 7, roleLabel: 'Builder' })).toEqual({
      id: '001A',
      no: 'No.7',
      type: 'B',
      line: 'ID 001A · No.7 · TYPE B'
    })
  })

  describe('id', () => {
    it.each<[number, string]>([
      [0, '0000'],
      [1, '0001'],
      [26, '001A'],
      [255, '00FF'],
      [4095, '0FFF'],
      [65535, 'FFFF'],
      [65536, '10000'], // grows past four digits rather than truncating
      [1_048_575, 'FFFFF']
    ])('%i -> %s', (userId, id) => {
      expect(designationFor({ userId, rank: null, roleLabel: null }).id).toBe(id)
    })

    it('tolerates a fractional or negative id', () => {
      expect(designationFor({ userId: 26.9, rank: null, roleLabel: null }).id).toBe('001A')
      expect(designationFor({ userId: -3, rank: null, roleLabel: null }).id).toBe('0000')
      expect(designationFor({ userId: NaN, rank: null, roleLabel: null }).id).toBe('0000')
    })
  })

  describe('no', () => {
    it('reads No.{rank} for a ranked pilot', () => {
      expect(designationFor({ userId: 1, rank: 1, roleLabel: null }).no).toBe('No.1')
      expect(designationFor({ userId: 1, rank: 1204, roleLabel: null }).no).toBe('No.1204')
    })

    it('reads UNRANKED for null or zero', () => {
      expect(designationFor({ userId: 1, rank: null, roleLabel: null }).no).toBe('UNRANKED')
      expect(designationFor({ userId: 1, rank: 0, roleLabel: null }).no).toBe('UNRANKED')
    })
  })

  describe('type', () => {
    it('takes the first letter of the role label, upper-cased', () => {
      expect(designationFor({ userId: 1, rank: null, roleLabel: 'developer' }).type).toBe('D')
      expect(designationFor({ userId: 1, rank: null, roleLabel: 'Designer' }).type).toBe('D')
    })

    it('skips leading non-letters', () => {
      expect(designationFor({ userId: 1, rank: null, roleLabel: '  3D artist' }).type).toBe('D')
    })

    it('is null without a role or a letter', () => {
      expect(designationFor({ userId: 1, rank: null, roleLabel: null }).type).toBeNull()
      expect(designationFor({ userId: 1, rank: null, roleLabel: '' }).type).toBeNull()
      expect(designationFor({ userId: 1, rank: null, roleLabel: '123' }).type).toBeNull()
    })
  })

  describe('line', () => {
    it('omits TYPE when there is no role', () => {
      expect(designationFor({ userId: 26, rank: 7, roleLabel: null }).line).toBe('ID 001A · No.7')
    })

    it('reads UNRANKED in the middle segment', () => {
      expect(designationFor({ userId: 26, rank: null, roleLabel: 'Founder' }).line).toBe(
        'ID 001A · UNRANKED · TYPE F'
      )
    })

    it('is just the id and rank state at minimum', () => {
      expect(designationFor({ userId: 0, rank: null, roleLabel: null }).line).toBe(
        'ID 0000 · UNRANKED'
      )
    })
  })
})
