// Passport-style machine-readable zone for the pilot license footer.
//
// Two fixed-width lines, always exactly MRZ_WIDTH glyphs: uppercase,
// `[A-Z0-9<]` only, `<` between words, `<<` between fields, `<` fill out
// to the edge and hard truncation past it. Pure string work so the layout
// can render it, the motion module can stagger its glyphs, and the tests
// can pin the exact bytes.

export const MRZ_WIDTH = 44

export interface MrzInput {
  username: string
  rank: number
  score: number
  /** ISO date string of account creation, or null/undefined when unknown */
  joined: string | null | undefined
  /** true → "ONLINE" instead of a SEEN field */
  isActive: boolean
  /** Already-humanised relative label, e.g. "2h ago" / "3 days ago" (output of
   *  formatRelative in src/components/dashboard-v2/format.ts — read it to see
   *  the shapes). null when unknown. Ignored when isActive. */
  seenLabel: string | null
  /** Role label such as "FOUNDER" or null */
  role: string | null
}

const FIELD_GAP = '<<'
const UNKNOWN = 'UNKNOWN'

/** One MRZ field: accents fold onto their base letter, word breaks
 *  (space, `-`, `_`, `.`) become `<`, anything else is dropped, runs of
 *  `<` collapse to one and the edges are trimmed so fields join cleanly. */
const field = (raw: string): string =>
  raw
    .normalize('NFD')
    .toUpperCase()
    .replace(/[\s\-_.]+/g, '<')
    .replace(/[^A-Z0-9<]/g, '')
    .replace(/<+/g, '<')
    .replace(/^<|<$/g, '')

/** Non-negative integer digits; anything that is not a finite number
 *  reads as zero rather than leaking `NAN` or `-` into the zone. */
const digits = (n: number): string =>
  Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : '0'

/** `Jul 2025` for the joined date, or null when missing / unparseable.
 *  Pinned to UTC so the month never shifts with the viewer's clock. */
const monthYear = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

/** The relative label is only usable if something survives sanitising —
 *  formatRelative hands back `—` for an unknown timestamp. */
const seenText = (input: MrzInput): string | null => {
  if (input.isActive || !input.seenLabel) return null
  return field(input.seenLabel) ? input.seenLabel.trim() : null
}

const line = (fields: Array<string | null>): string =>
  fields
    .filter((f): f is string => Boolean(f))
    .join(FIELD_GAP)
    .padEnd(MRZ_WIDTH, '<')
    .slice(0, MRZ_WIDTH)

/** Two machine-readable-zone lines, each EXACTLY MRZ_WIDTH chars. */
export function buildMrz(input: MrzInput): [string, string] {
  const joined = monthYear(input.joined)
  const seen = seenText(input)
  const rank = Number.isFinite(input.rank) && input.rank >= 1 ? digits(input.rank) : UNKNOWN

  const line1 = line([
    `JOINED<${joined ? field(joined) : UNKNOWN}`,
    input.isActive ? 'ONLINE' : `SEEN<${seen ? field(seen) : UNKNOWN}`
  ])
  const line2 = line([
    field(input.username ?? ''),
    `RANK<${rank}`,
    `${digits(input.score)}<PTS`,
    input.role ? field(input.role) : null
  ])
  return [line1, line2]
}

/** Plain sentence for screen readers, e.g.
 *  "Joined Jul 2025, last seen 2h ago" / "Joined Jul 2025, online now" /
 *  "Joined unknown, last seen 2h ago". */
export function mrzPlainText(input: MrzInput): string {
  const joined = monthYear(input.joined) ?? 'unknown'
  const seen = input.isActive ? 'online now' : `last seen ${seenText(input) ?? 'unknown'}`
  return `Joined ${joined}, ${seen}`
}
