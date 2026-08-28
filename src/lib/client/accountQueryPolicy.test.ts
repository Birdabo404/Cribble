import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldLoadAccountQueries } from './accountQueryPolicy'

const appNav = readFileSync(join(process.cwd(), 'src/components/nav/AppNav.tsx'), 'utf8')
const sponsorship = readFileSync(
  join(process.cwd(), 'src/components/billboard/BillboardLanding.tsx'),
  'utf8'
)
const extensionGate = readFileSync(
  join(process.cwd(), 'src/components/ExtensionGate.tsx'),
  'utf8'
)

describe('account-only client query policy', () => {
  it.each([
    ['anonymous', false],
    ['loading', false],
    ['signed-in', true],
    ['error', false]
  ] as const)('%s session => %s', (state, expected) => {
    expect(shouldLoadAccountQueries(state)).toBe(expected)
  })

  it('gates the persistent notification provider on the resolved nav user', () => {
    expect(appNav).toContain('enabled={shouldLoadAccountQueries(')
    expect(appNav).toContain("!navUser.loaded ? 'loading' : navUser.user ? 'signed-in' : 'anonymous'")
  })

  it('waits for positive authentication before loading sponsorship submissions', () => {
    expect(sponsorship).toContain("shouldLoadAccountQueries(signedIn === null ? 'loading'")
    expect(sponsorship).toContain('void loadMine()')
  })

  it('waits for the shared positive session probe before onboarding', () => {
    expect(extensionGate.indexOf('const session = await fetchMe()')).toBeGreaterThan(-1)
    expect(extensionGate.indexOf("fetch('/api/user/onboarding'")).toBeGreaterThan(
      extensionGate.indexOf('if (!session.ok)')
    )
  })
})
