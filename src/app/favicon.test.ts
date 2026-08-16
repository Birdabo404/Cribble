import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('favicon routes', () => {
  it('does not ship a public/favicon.ico alongside src/app/favicon.ico', () => {
    // Next.js maps app/favicon.ico to /favicon.ico. A public file at the
    // same path 500s: conflicting-public-file-page.
    expect(existsSync(resolve(root, 'src/app/favicon.ico'))).toBe(true)
    expect(existsSync(resolve(root, 'public/favicon.ico'))).toBe(false)
  })
})
