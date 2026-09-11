import { describe, expect, it } from 'vitest'
import { HARNESS_MARKS, aiToolMark, aiToolMonogram } from './aiToolMarks'
import { HARNESS_BRANDS, harnessBrandForLabel } from './harnessBrands'
import { tokenAgentLabel } from './tokenLeaderboard'

/** Absolute-command path data only (M/L/H/V/C/Z, numbers, spaces) — what
 *  every mark in the registry is authored as, so a stray relative command
 *  or transform sneaking in through a trace fails here, not in a browser. */
const PATH_DATA = /^[MLHVCZ0-9. -]+$/

function pathBounds(path: string) {
  // H and V carry one coordinate; every other command carries x,y pairs.
  const xs: number[] = []
  const ys: number[] = []
  for (const cmd of path.match(/[MLHVC][^MLHVCZ]*/g) ?? []) {
    const nums = (cmd.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number)
    if (cmd[0] === 'H') xs.push(...nums)
    else if (cmd[0] === 'V') ys.push(...nums)
    else nums.forEach((n, i) => (i % 2 === 0 ? xs : ys).push(n))
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

describe('harness marks', () => {
  /** Every collector id → the mark the board must draw for it. */
  const COLLECTOR_IDS: Record<string, keyof typeof HARNESS_MARKS> = {
    hermes: 'hermes',
    'hermes-agent': 'hermes',
    Hermes: 'hermes',
    pi: 'pi',
    'pi-coding-agent': 'pi',
    'pi-mono': 'pi',
    omp: 'omp',
    OMP: 'omp',
    'oh-my-pi': 'omp',
    oh_my_pi: 'omp',
    'Oh My Pi': 'omp',
    opencode: 'opencode',
    'open-code': 'opencode',
    'Open Code': 'opencode',
    OpenCode: 'opencode'
  }

  it('resolves every label tokenAgentLabel produces for Hermes, Pi, oh-my-pi and OpenCode', () => {
    for (const [id, key] of Object.entries(COLLECTOR_IDS)) {
      const label = tokenAgentLabel(id)
      expect(label, id).not.toBeNull()
      expect(aiToolMark(label as string), `${id} → ${label}`).toBe(HARNESS_MARKS[key])
    }
  })

  it('pins the exact labels the burn board and AGENTS slab print', () => {
    expect(tokenAgentLabel('hermes')).toBe('Hermes')
    expect(tokenAgentLabel('pi')).toBe('Pi')
    expect(tokenAgentLabel('opencode')).toBe('OpenCode')
    expect(tokenAgentLabel('open-code')).toBe('OpenCode')
    // oh-my-pi has no harnessBrands record, so its ids title-case.
    expect(harnessBrandForLabel('Omp')).toBeUndefined()
    expect(tokenAgentLabel('omp')).toBe('Omp')
    expect(tokenAgentLabel('oh-my-pi')).toBe('Oh My Pi')
  })

  it('keeps every registry harness with an image asset on a vector mark here', () => {
    // Hermes, Pi and OpenCode ship raster/tile assets for the old boxed
    // renderer; the monochrome board must never fall back to their monogram.
    for (const brand of HARNESS_BRANDS) {
      if (brand.mark.kind !== 'image') continue
      expect(aiToolMark(brand.label), brand.label).not.toBeNull()
    }
  })

  it('leaves Openclaw on the monogram until an official mark ships under public/agents', () => {
    expect(aiToolMark('Openclaw')).toBeNull()
  })

  it('authors each traced mark as absolute path data inside the 24-grid', () => {
    for (const [key, mark] of Object.entries(HARNESS_MARKS)) {
      expect(mark.path, key).toMatch(PATH_DATA)
      expect(mark.fillRule, key).toBe('evenodd')
      const { minX, maxX, minY, maxY } = pathBounds(mark.path)
      expect(minX, key).toBeGreaterThanOrEqual(0)
      expect(minY, key).toBeGreaterThanOrEqual(0)
      expect(maxX, key).toBeLessThanOrEqual(24)
      expect(maxY, key).toBeLessThanOrEqual(24)
      // A mark that collapsed to a sliver or a filled square is a regression.
      expect(maxX - minX, key).toBeGreaterThan(12)
      expect(maxY - minY, key).toBeGreaterThan(12)
    }
  })

  it('gives every harness its own geometry and title', () => {
    const paths = Object.values(HARNESS_MARKS).map((m) => m.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(Object.values(HARNESS_MARKS).map((m) => m.title)).size).toBe(paths.length)
    expect(HARNESS_MARKS.opencode.path).not.toBe(HARNESS_MARKS.pi.path)
    expect(HARNESS_MARKS.opencode.path).not.toBe(HARNESS_MARKS.omp.path)
  })

  it('sits OpenCode on the same 1-unit vertical margin as Pi', () => {
    const pi = pathBounds(HARNESS_MARKS.pi.path)
    const oc = pathBounds(HARNESS_MARKS.opencode.path)
    expect(oc.minY).toBe(pi.minY)
    expect(oc.maxY).toBe(pi.maxY)
    // 4:5 frame centred on x = 12
    expect(oc.minX + oc.maxX).toBeCloseTo(24, 5)
  })
})

describe('aiToolMark / aiToolMonogram', () => {
  it('returns null for names without an official mark and trims whitespace', () => {
    expect(aiToolMark('Midjourney')).toBeNull()
    expect(aiToolMark('Not A Tool')).toBeNull()
    expect(aiToolMark('  Pi ')).toBe(HARNESS_MARKS.pi)
  })

  it('leaves Simple Icons marks on the default fill rule', () => {
    expect(aiToolMark('Cursor')?.fillRule).toBeUndefined()
    expect(aiToolMark('Codex')?.fillRule).toBeUndefined()
  })

  it('still derives monograms for genuinely unknown harnesses', () => {
    expect(aiToolMonogram('Openclaw')).toBe('OP')
    expect(aiToolMonogram('Some Agent')).toBe('SA')
    expect(aiToolMonogram('x')).toBe('X?')
    expect(aiToolMonogram('Midjourney')).toBe('MJ')
  })
})
