import { describe, expect, it } from 'vitest'
import { buildMrz, MRZ_WIDTH, mrzPlainText, type MrzInput } from './mrz'

// Midday, mid-month, pinned to UTC: the same calendar month on any clock.
const JOINED = '2025-07-15T12:00:00.000Z'

const base: MrzInput = {
  username: 'birdabo',
  rank: 11,
  score: 45308,
  joined: JOINED,
  isActive: false,
  seenLabel: '2h ago',
  role: 'FOUNDER'
}

const mrz = (patch: Partial<MrzInput> = {}) => buildMrz({ ...base, ...patch })

describe('buildMrz', () => {
  it('prints the reference card', () => {
    const [line1, line2] = mrz()
    expect(line1).toBe('JOINED<JUL<2025<<SEEN<2H<AGO<<<<<<<<<<<<<<<<')
    expect(line2).toBe('BIRDABO<<RANK<11<<45308<PTS<<FOUNDER<<<<<<<<')
  })

  it('is exactly MRZ_WIDTH wide for short and long inputs', () => {
    const short = mrz({ username: 'a', rank: 1, score: 0, joined: null, seenLabel: null, role: null })
    const long = mrz({
      username: 'the_longest-username.anyone has ever typed into this box',
      rank: 123456,
      score: 9876543210,
      role: 'FOUNDING ENGINEER EMERITUS'
    })
    for (const lines of [short, long]) {
      expect(lines).toHaveLength(2)
      expect(lines[0]).toHaveLength(MRZ_WIDTH)
      expect(lines[1]).toHaveLength(MRZ_WIDTH)
    }
  })

  it('fills the tail with < and nothing else', () => {
    const [line1, line2] = mrz()
    expect(line1.slice(line1.indexOf('AGO') + 3)).toMatch(/^<+$/)
    expect(line2.slice(line2.indexOf('FOUNDER') + 7)).toMatch(/^<+$/)
    expect(line1).toMatch(/^[A-Z0-9<]+$/)
    expect(line2).toMatch(/^[A-Z0-9<]+$/)
  })

  it('turns spaces, dashes, underscores and dots into single <', () => {
    const [, line2] = mrz({ username: 'bird-abo_x y' })
    expect(line2.startsWith('BIRD<ABO<X<Y<<RANK<11')).toBe(true)
    const [, dotted] = mrz({ username: 'a.. b--c__d' })
    expect(dotted.startsWith('A<B<C<D<<')).toBe(true)
  })

  it('reads JOINED<UNKNOWN when the join date is missing or garbage', () => {
    expect(mrz({ joined: null })[0].startsWith('JOINED<UNKNOWN<<SEEN')).toBe(true)
    expect(mrz({ joined: undefined })[0].startsWith('JOINED<UNKNOWN<<SEEN')).toBe(true)
    expect(mrz({ joined: 'not a date' })[0].startsWith('JOINED<UNKNOWN<<SEEN')).toBe(true)
  })

  it('shows ONLINE instead of a SEEN field while active', () => {
    const [line1] = mrz({ isActive: true, seenLabel: '2h ago' })
    expect(line1).toBe('JOINED<JUL<2025<<ONLINE<<<<<<<<<<<<<<<<<<<<<')
    expect(line1).not.toContain('SEEN')
  })

  it('folds the relative label into the SEEN field', () => {
    expect(mrz({ seenLabel: '2h ago' })[0]).toContain('<<SEEN<2H<AGO<')
    expect(mrz({ seenLabel: 'just now' })[0]).toContain('<<SEEN<JUST<NOW<')
    expect(mrz({ seenLabel: '3d ago' })[0]).toContain('<<SEEN<3D<AGO<')
    expect(mrz({ seenLabel: '3 days ago' })[0]).toContain('<<SEEN<3<DAYS<AGO<')
  })

  it('reads SEEN<UNKNOWN for a null or empty-after-sanitising label', () => {
    expect(mrz({ seenLabel: null })[0]).toContain('<<SEEN<UNKNOWN<')
    // formatRelative hands back an em dash for a missing timestamp.
    expect(mrz({ seenLabel: '—' })[0]).toContain('<<SEEN<UNKNOWN<')
    expect(mrz({ seenLabel: '   ' })[0]).toContain('<<SEEN<UNKNOWN<')
  })

  it('omits the role field when there is none', () => {
    const [, line2] = mrz({ role: null })
    expect(line2).toBe('BIRDABO<<RANK<11<<45308<PTS<<<<<<<<<<<<<<<<<')
    expect(line2).not.toContain('FOUNDER')
  })

  it('prints the score as raw digits', () => {
    expect(mrz({ score: 1234567 })[1]).toContain('<<1234567<PTS')
    expect(mrz({ score: 45308.6 })[1]).toContain('<<45309<PTS')
  })

  it('hard-truncates a very long username without throwing', () => {
    const username = 'x'.repeat(200)
    const [line1, line2] = mrz({ username })
    expect(line1).toHaveLength(MRZ_WIDTH)
    expect(line2).toHaveLength(MRZ_WIDTH)
    expect(line2).toBe('X'.repeat(MRZ_WIDTH))
  })

  it('strips characters outside A-Z0-9 and folds accents', () => {
    const [, line2] = mrz({ username: 'josé 日本 ünïcode!@#$%^&*()' })
    expect(line2.startsWith('JOSE<UNICODE<<RANK<11')).toBe(true)
    expect(line2).toMatch(/^[A-Z0-9<]+$/)
  })

  it('survives weird numbers and an empty username', () => {
    const [line1, line2] = mrz({ username: '', rank: -4, score: Number.NaN, role: null })
    expect(line1).toHaveLength(MRZ_WIDTH)
    expect(line2).toBe('RANK<UNKNOWN<<0<PTS<<<<<<<<<<<<<<<<<<<<<<<<<')
    expect(mrz({ score: Number.POSITIVE_INFINITY })[1]).toContain('<<0<PTS')
    expect(mrz({ score: -50 })[1]).toContain('<<0<PTS')
  })
})

describe('mrzPlainText', () => {
  it('reads the joined month and the last-seen label', () => {
    expect(mrzPlainText(base)).toBe('Joined Jul 2025, last seen 2h ago')
  })

  it('says online now while active', () => {
    expect(mrzPlainText({ ...base, isActive: true })).toBe('Joined Jul 2025, online now')
  })

  it('says unknown for a missing join date', () => {
    expect(mrzPlainText({ ...base, joined: null })).toBe('Joined unknown, last seen 2h ago')
  })

  it('says unknown for a missing or blank seen label', () => {
    expect(mrzPlainText({ ...base, seenLabel: null })).toBe('Joined Jul 2025, last seen unknown')
    expect(mrzPlainText({ ...base, seenLabel: '—' })).toBe('Joined Jul 2025, last seen unknown')
  })
})
