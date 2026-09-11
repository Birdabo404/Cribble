// The podium's standing. The persona ladder is a peerage of spend that
// tops out at COMPUTE BARON, so ten barons in a row read as one rank;
// the top three carry the peerage past the barony to the crown — THE
// DUKE, THE REGENT, THE MONARCH — printed in the row's medal hue in place
// of the persona. The article is the point: there is one of each. Rank 3
// is already a promotion over every baron beneath it.

const TITLES = ['THE MONARCH', 'THE REGENT', 'THE DUKE'] as const

export type BurnTitle = (typeof TITLES)[number]

/** The rank title for the podium (1–3); null for every rank below it. */
export function burnTitle(rank: number): BurnTitle | null {
  return rank >= 1 && rank <= TITLES.length ? TITLES[rank - 1] : null
}
