import { describe, expect, it } from 'vitest'
import { dockAccepted } from './HangarPane'

// The route never fails a save over one bad pin — cleanPins drops it
// silently — so the pane reads the echoed list to tell a docked link
// from a dropped one. Pinned here because the alternative is a pending
// bay that vanishes on the refetch with nothing said.

describe('dockAccepted', () => {
  it('accepts when the echoed list grew by the new link', () => {
    expect(dockAccepted(2, ['a', 'b', 'c'])).toBe(true)
    expect(dockAccepted(0, ['a'])).toBe(true)
  })

  it('rejects when the echoed list is no longer than before (dropped or deduped)', () => {
    expect(dockAccepted(2, ['a', 'b'])).toBe(false)
    expect(dockAccepted(0, [])).toBe(false)
  })

  it('rejects when the server also trimmed an older pin', () => {
    // A stale pin failing today's rules costs a bay too; the new one
    // still did not add a bay, so the owner hears about it.
    expect(dockAccepted(3, ['a', 'b', 'c'])).toBe(false)
  })

  it('treats a missing echo as accepted — the refetch settles it', () => {
    expect(dockAccepted(2, undefined)).toBe(true)
  })
})
