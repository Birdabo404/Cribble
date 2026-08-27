import { describe, expect, it } from 'vitest'
import { identityForTool, toolInkRgb, toolRgbA } from './aiToolIdentity'

describe('identityForTool', () => {
  it('serves the curated houses their brand hue and epithet', () => {
    expect(identityForTool('ChatGPT')).toEqual({
      rgb: '16 163 127',
      hex: '#10A37F',
      epithet: 'HOUSE DEFAULT'
    })
    expect(identityForTool('Claude')).toEqual({
      rgb: '217 119 87',
      hex: '#D97757',
      epithet: 'THE ORANGE HOUSE'
    })
    expect(identityForTool('Grok')).toEqual({
      rgb: '232 232 232',
      hex: '#E8E8E8',
      epithet: 'BLACK STAR'
    })
    expect(identityForTool('Gemini')).toEqual({
      rgb: '124 110 254',
      hex: '#7C6EFE',
      epithet: 'THE PRISM'
    })
    expect(identityForTool('Cursor')).toEqual({
      rgb: '200 200 205',
      hex: '#C8C8CD',
      epithet: 'THE COCKPIT'
    })
  })

  it('keeps sibling houses on one hue', () => {
    expect(identityForTool('OpenAI').rgb).toBe(identityForTool('ChatGPT').rgb)
    expect(identityForTool('Copilot').rgb).toBe(identityForTool('GitHub Copilot').rgb)
    expect(identityForTool('Microsoft Copilot').rgb).toBe(
      identityForTool('GitHub Copilot').rgb
    )
    expect(identityForTool('Bard').rgb).toBe(identityForTool('Gemini').rgb)
    expect(identityForTool('AI Studio').rgb).toBe(identityForTool('Gemini').rgb)
  })

  it('derives a stable identity for unknown tools — never random', () => {
    const first = identityForTool('Totally New Tool')
    const second = identityForTool('Totally New Tool')

    expect(first).toEqual(second)
    expect(first.rgb).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
    expect(first.hex).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('epithets unknown tools off their first word', () => {
    expect(identityForTool('Windsurf').epithet).toBe('THE BREAK')
    expect(identityForTool('Unknownforge').epithet).toBe('THE UNKNOWNFORGE')
    expect(identityForTool('Stability AI').epithet).toBe('HOUSE STABILITY')
  })

  it('typically separates distinct unknown names (collisions allowed, not the norm)', () => {
    // Not a hard uniqueness guarantee — just that the hash actually
    // spreads: a handful of unrelated names must not all share one hue.
    const hues = new Set(
      ['Windsurf', 'Codeium', 'Tabnine', 'Udio', 'Krea'].map(
        (name) => identityForTool(name).rgb
      )
    )
    expect(hues.size).toBeGreaterThan(1)
  })
})

describe('toolRgbA', () => {
  it('formats a triplet into the alpha-mix syntax medalA uses', () => {
    expect(toolRgbA('217 119 87', 0.4)).toBe('rgb(217 119 87 / 0.4)')
    expect(toolRgbA('16 163 127', 1)).toBe('rgb(16 163 127 / 1)')
  })
})

describe('toolInkRgb', () => {
  it('passes dark-enough hues through untouched', () => {
    expect(toolInkRgb('16 163 127')).toBe('16 163 127')
    expect(toolInkRgb('0 100 224')).toBe('0 100 224')
  })

  it('pulls near-white hues down to readable ink on white', () => {
    const ink = toolInkRgb('232 232 232').split(' ').map(Number)
    expect(ink.every((c) => c < 140)).toBe(true)
  })
})
