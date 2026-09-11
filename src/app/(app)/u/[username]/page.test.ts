import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/(app)/u/[username]/page.tsx', 'utf8')

describe('public profile HTTP contract', () => {
  it('returns a framework 404 for genuine absences and keeps outages retryable', () => {
    expect(page).toContain("if (snapshot.state === 'missing') notFound()")
    expect(page).toContain("case 'error':")
    expect(page).not.toContain("if (snapshot.state === 'error') notFound()")
  })
})
