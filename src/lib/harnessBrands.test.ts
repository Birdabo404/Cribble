import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  HARNESS_AGENT_LABELS,
  HARNESS_BRANDS,
  harnessBrandForLabel,
  harnessFallbackLetter
} from './harnessBrands'
import { validateSvgAsset } from './svgAssetValidator'
import { normalizeAgentId, tokenAgentLabel } from './tokenLeaderboard'

describe('harness brand registry', () => {
  it('keeps every alias in normalized form so lookups cannot miss', () => {
    for (const brand of HARNESS_BRANDS) {
      for (const alias of brand.aliases) {
        expect(normalizeAgentId(alias)).toBe(alias)
      }
    }
  })

  it('never maps one alias to two harnesses', () => {
    const aliases = HARNESS_BRANDS.flatMap((brand) => [...brand.aliases])
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('keeps labels unique and resolvable back to their record', () => {
    const labels = HARNESS_BRANDS.map((brand) => brand.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const brand of HARNESS_BRANDS) {
      expect(harnessBrandForLabel(brand.label)).toBe(brand)
    }
  })

  it('routes every alias through tokenAgentLabel to the registry label', () => {
    for (const brand of HARNESS_BRANDS) {
      for (const alias of brand.aliases) {
        expect(tokenAgentLabel(alias)).toBe(brand.label)
        expect(HARNESS_AGENT_LABELS[alias]).toBe(brand.label)
      }
    }
  })

  it('ships every image mark as a pinned file under public/', () => {
    for (const brand of HARNESS_BRANDS) {
      if (brand.mark.kind !== 'image') continue
      expect(brand.mark.src.startsWith('/agents/')).toBe(true)
      expect(existsSync(join(process.cwd(), 'public', brand.mark.src))).toBe(true)
    }
  })

  it('only ships SVG image marks that pass the fail-closed validator', () => {
    for (const brand of HARNESS_BRANDS) {
      if (brand.mark.kind !== 'image' || !brand.mark.src.endsWith('.svg')) continue
      const source = readFileSync(join(process.cwd(), 'public', brand.mark.src), 'utf8')
      expect(validateSvgAsset(source)).toEqual({ ok: true })
    }
  })

  it('derives a deterministic same-size fallback letter from the label', () => {
    expect(harnessFallbackLetter('Pi')).toBe('P')
    expect(harnessFallbackLetter('OpenCode')).toBe('O')
    expect(harnessFallbackLetter('hermes')).toBe('H')
    expect(harnessFallbackLetter('  ')).toBe('?')
  })
})
