import { describe, expect, it } from 'vitest'
import { metadata } from './not-found'

describe('global not-found metadata', () => {
  it('is non-indexable and describes a missing route rather than maintenance', () => {
    expect(metadata.title).toBe('Not Found — Cribble')
    expect(metadata.description).toContain('No Cribble route')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(JSON.stringify(metadata)).not.toContain('503')
  })
})