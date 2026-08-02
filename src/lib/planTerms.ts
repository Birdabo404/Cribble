// Checkout-term metadata for the two subscription lanes, shared by every
// surface that sells them (the shop's Pro hero, the /teams chooser). One
// source of truth so a price change never has to chase duplicated copy.
//
// The `type` slugs /api/checkout accepts are `pro_${term}` and
// `team_${term}` — both storefronts build their hrefs from these keys.

export type BillingTerm = 'monthly' | 'yearly'

export interface PlanTermMeta {
  /** Scoreboard price — rendered digit by digit. */
  price: string
  /** Unit tag next to the price (/ MO, / YR). */
  unit: string
  /** Context line under the scoreboard. */
  context: string
  /** Screen-reader announcement for the live region. */
  announce: string
}

/** Cribble Pro — the personal subscription. Yearly leads: it is
 *  preselected and carries the value tag, so the honest default is also
 *  the best deal. */
export const PRO_TERMS: Record<BillingTerm, PlanTermMeta> = {
  monthly: {
    price: '$6.99',
    unit: '/ MO',
    context: 'BILLED MONTHLY · CANCEL ANYTIME',
    announce: '$6.99 per month, billed monthly'
  },
  yearly: {
    price: '$49.99',
    unit: '/ YR',
    context: '≈ $4.17 / MO · SAVE $33.89 A YEAR',
    announce: '$49.99 per year, about $4.17 per month'
  }
}

/** Cribble Team — the company plan. Same two-position dial contract. */
export const TEAM_TERMS: Record<BillingTerm, PlanTermMeta> = {
  monthly: {
    price: '$50',
    unit: '/ MO',
    context: 'BILLED MONTHLY · CANCEL ANYTIME',
    announce: '$50 per month, billed monthly'
  },
  yearly: {
    price: '$500',
    unit: '/ YR',
    context: '≈ $41.67 / MO · SAVE $100 A YEAR',
    announce: '$500 per year, about $41.67 per month'
  }
}
