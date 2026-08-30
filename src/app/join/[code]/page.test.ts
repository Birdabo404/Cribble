import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/join/[code]/page.tsx', 'utf8')
const card = readFileSync('src/app/join/[code]/opengraph-image.tsx', 'utf8')

describe('/join route presentation contract', () => {
  it('redirects and uses affirmative copy only after validation', () => {
    expect(page).toContain("const valid = state.status === 'valid'")
    expect(page).toContain('{valid ? <JoinRedirect href={href} /> : null}')
    expect(page).toContain("data-invite-state={state.status}")
    expect(page).toContain('INVITE NOT VALID')
    expect(page).toContain('INVITE EXPIRED')
    expect(page).toContain('INVITE ALREADY USED')
    expect(page).toContain('COULD NOT CHECK INVITE')
  })

  it('keeps unverified crawler metadata and image neutral and hides the code', () => {
    expect(page).toContain("const title = valid ? VALID_TITLE : VERIFY_TITLE")
    expect(card).toContain("valid ? \"YOU'RE\" : 'VERIFY'")
    expect(card).toContain("valid ? 'INVITED!' : 'INVITE'")
    expect(card).toContain("'NOT DISPLAYED'")
    expect(card).not.toContain('const serial = cells ? `${cells.slice(0, 4).join(\'\')}-${cells.slice(4).join(\'\')}` : normalized')
  })
})
