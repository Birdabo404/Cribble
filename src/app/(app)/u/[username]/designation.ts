// DESIGNATION line under the pilot's handle: `ID 001A · No.7 · TYPE B`.
// Derived entirely from fields the profile already carries — the user id
// in hex (padded to four, the tactical-reference look), the leaderboard
// rank, and the first letter of the role label — so it costs nothing on
// the backend and never disagrees with the rest of the page.

export interface Designation {
  /** userId as upper-case hex, left-padded to 4 (26 -> '001A'). */
  id: string
  /** 'No.{rank}' or 'UNRANKED'. */
  no: string
  /** First alphabetic character of the role label, upper-cased; null
   *  when there is no role (or no letter in it). */
  type: string | null
  /** The segments joined with ' · '; TYPE omitted when null. */
  line: string
}

export interface DesignationInput {
  userId: number
  rank: number | null
  roleLabel: string | null
}

const SEPARATOR = ' · '

export function designationFor({ userId, rank, roleLabel }: DesignationInput): Designation {
  const safeId = Number.isFinite(userId) ? Math.max(0, Math.trunc(userId)) : 0
  const id = safeId.toString(16).toUpperCase().padStart(4, '0')
  const no = rank && rank > 0 ? `No.${Math.trunc(rank)}` : 'UNRANKED'
  const letter = roleLabel?.match(/[a-z]/i)?.[0] ?? null
  const type = letter ? letter.toUpperCase() : null

  const segments = [`ID ${id}`, no]
  if (type) segments.push(`TYPE ${type}`)

  return { id, no, type, line: segments.join(SEPARATOR) }
}
