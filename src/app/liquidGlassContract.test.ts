import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return ''
  return css.slice(start, css.indexOf('}', start))
}

describe('liquid glass crisp-content contract', () => {
  it('never projects the host and its readable subtree', () => {
    expect(rule('.liquid-glass')).not.toMatch(/\btransform\s*:/)
  })

  it('projects the visual shell with delegated tilt variables', () => {
    expect(rule('.liquid-glass::after')).toMatch(
      /transform:\s*perspective\(1100px\) rotateX\(var\(--tilt-x, 0deg\)\)/
    )
  })

  it('keeps the shell behind content and non-interactive', () => {
    expect(rule('.liquid-glass::after')).toMatch(/z-index:\s*-1/)
    expect(rule('.liquid-glass::after')).toMatch(/pointer-events:\s*none/)
    expect(rule('.liquid-glass')).toMatch(/isolation:\s*isolate/)
  })
})
