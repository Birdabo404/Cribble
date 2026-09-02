import { describe, expect, it } from 'vitest'
import {
  createMobiusRibbon,
  HALF_WIDTH,
  lemniscate,
  LIFT,
  mobiusFrame,
  shadeBand,
  type Vec3
} from './mobiusRibbon'

const TAU = Math.PI * 2
const EPS = 1e-6

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z)
const expectClose = (a: Vec3, b: Vec3) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS)
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS)
  expect(Math.abs(a.z - b.z)).toBeLessThan(EPS)
}

const PHASES = [0, 0.7, 2.9, -1.3]
const TS = [0, 0.3, Math.PI / 2, 2.1, Math.PI, 4, (3 * Math.PI) / 2, 5.5]

describe('mobiusFrame — strip closure', () => {
  it('closes with the Möbius flip: edgeA(2π) = edgeB(0) and vice versa', () => {
    for (const phase of PHASES) {
      const start = mobiusFrame(0, phase)
      const end = mobiusFrame(TAU, phase)
      expectClose(end.center, start.center)
      expectClose(end.edgeA, start.edgeB)
      expectClose(end.edgeB, start.edgeA)
    }
  })

  it('flips the normal across the seam, so |n_z| shading is continuous', () => {
    for (const phase of PHASES) {
      const start = mobiusFrame(0, phase)
      const end = mobiusFrame(TAU, phase)
      expectClose(end.normal, { x: -start.normal.x, y: -start.normal.y, z: -start.normal.z })
      expect(shadeBand(end.normal.z)).toBe(shadeBand(start.normal.z))
    }
  })
})

describe('shadeBand', () => {
  it('quantizes |n_z| at 0.85 / 0.6 / 0.3, inclusive at the top of each band', () => {
    expect(shadeBand(1)).toBe(0)
    expect(shadeBand(0.85)).toBe(0)
    expect(shadeBand(0.849)).toBe(1)
    expect(shadeBand(0.6)).toBe(1)
    expect(shadeBand(0.3)).toBe(2)
    expect(shadeBand(0.29)).toBe(3)
    expect(shadeBand(0)).toBe(3)
  })

  it('is two-sided — a sign flip of the normal never changes the band', () => {
    for (const v of [1, 0.85, 0.7, 0.6, 0.45, 0.3, 0.1, 0]) {
      expect(shadeBand(-v)).toBe(shadeBand(v))
    }
  })
})

describe('lemniscate — crossing', () => {
  it('passes through x = y = 0 twice, LIFT apart in z', () => {
    const over = lemniscate(Math.PI / 2)
    const under = lemniscate((3 * Math.PI) / 2)
    expect(over.x).toBeCloseTo(0, 9)
    expect(over.y).toBeCloseTo(0, 9)
    expect(under.x).toBeCloseTo(0, 9)
    expect(under.y).toBeCloseTo(0, 9)
    expect(over.z).toBeCloseTo(LIFT, 9)
    expect(under.z).toBeCloseTo(-LIFT, 9)
    expect(LIFT).toBeGreaterThan(0)
  })

  it('keeps an edge-on strand clear of the strand beneath it', () => {
    // The two strands at the crossing carry width vectors 90° apart, so
    // their combined z reach peaks at √2·HALF_WIDTH; the lift must beat it.
    expect(2 * LIFT).toBeGreaterThan(Math.SQRT2 * HALF_WIDTH)
  })
})

describe('mobiusFrame — cross-section', () => {
  it('has a unit normal perpendicular to the width vector', () => {
    for (const phase of PHASES) {
      for (const t of TS) {
        const { center, edgeA, normal } = mobiusFrame(t, phase)
        const w = sub(edgeA, center)
        expect(Math.abs(len(normal) - 1)).toBeLessThan(EPS)
        expect(Math.abs(dot(normal, w))).toBeLessThan(EPS)
        expect(Math.abs(len(w) - HALF_WIDTH)).toBeLessThan(EPS)
      }
    }
  })

  it('keeps the width vector perpendicular to the curve (analytic tangent agrees with a numeric one)', () => {
    const h = 1e-5
    for (const t of TS) {
      const numeric = sub(lemniscate(t + h), lemniscate(t - h))
      const { center, edgeA, normal } = mobiusFrame(t, 0.4)
      const w = sub(edgeA, center)
      const unit = { x: numeric.x / len(numeric), y: numeric.y / len(numeric), z: numeric.z / len(numeric) }
      expect(Math.abs(dot(unit, w))).toBeLessThan(1e-6)
      expect(Math.abs(dot(unit, normal))).toBeLessThan(1e-6)
    }
  })

  it('turns the width vector half a turn over the loop', () => {
    const a = sub(mobiusFrame(0, 0).edgeA, mobiusFrame(0, 0).center)
    const b = sub(mobiusFrame(Math.PI, 0).edgeA, mobiusFrame(Math.PI, 0).center)
    // Quarter turn at t = π: W has moved from N into B, so they are orthogonal.
    expect(Math.abs(dot(a, b))).toBeLessThan(EPS)
  })
})

describe('createMobiusRibbon without a 2D context', () => {
  it('returns an inert renderer instead of throwing', () => {
    const fake = { getContext: () => null } as unknown as HTMLCanvasElement
    const ribbon = createMobiusRibbon(fake)
    expect(() => {
      ribbon.resize(300, 150, 2)
      ribbon.setColors({ signal: '#ccff00', sheet: '#05060a', ink: '#a1a1aa' })
      ribbon.draw({ phase: 0, drawn: 1, pitch: 0.384, yaw: 0 })
      ribbon.dispose()
    }).not.toThrow()
  })
})
