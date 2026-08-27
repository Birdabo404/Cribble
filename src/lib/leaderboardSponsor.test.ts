import { describe, expect, it } from 'vitest'
import {
  LEADERBOARD_FLIP_SPONSOR_HOLD_MS,
  LEADERBOARD_FLIP_STATS_HOLD_MS,
  LEADERBOARD_FLIP_TRANSITION_MS,
  LEADERBOARD_SPONSOR_GRACE_MS,
  LEADERBOARD_SPONSOR_INCREMENT_RATE,
  LEADERBOARD_SPONSOR_MAX_TARGET_CENTS,
  LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS,
  LEADERBOARD_SPONSOR_MIN_INCREMENT_CENTS,
  LEADERBOARD_SPONSOR_OPENING_CENTS,
  LEADERBOARD_SPONSOR_PENDING_TTL_MS,
  LEADERBOARD_SPONSOR_POLL_MS,
  LEADERBOARD_SPONSOR_WINDOW_MS,
  classifySponsorRun,
  formatSponsorUsd,
  leaderboardBidIncrementCents,
  leaderboardChargeCents,
  leaderboardMaxTargetCents,
  leaderboardMinTargetCents,
  rankLeaderboardSponsors
} from './leaderboardSponsor'

// Coverage for the pure pricing/ranking contracts: increment rounding,
// checkout floors and their overshoot, cumulative top-ups, the rolling
// 24h boundary, tie-breaking, refund removal and the flip cadence. The
// route/webhook layers are tested where they live (the leaderboard
// checkout route test and the Polar webhook test).

describe('leaderboardBidIncrementCents', () => {
  it('floors at $1 while 10% is below a dollar', () => {
    // 10% of $6.66 is 66.6c, which rounds UP to the same $1 floor.
    expect(leaderboardBidIncrementCents(666)).toBe(100)
    expect(leaderboardBidIncrementCents(999)).toBe(100)
    // Degenerate tiny totals still demand the full dollar.
    expect(leaderboardBidIncrementCents(1)).toBe(100)
  })

  it('rounds the 10% increment UP to whole dollars', () => {
    expect(leaderboardBidIncrementCents(1000)).toBe(100) // exactly $1
    expect(leaderboardBidIncrementCents(1001)).toBe(200) // 100.1c -> $2
    expect(leaderboardBidIncrementCents(2350)).toBe(300) // 235c -> $3
    expect(leaderboardBidIncrementCents(10000)).toBe(1000) // exactly $10
  })

  it('never rounds down: a cent over an exact dollar boundary costs the next dollar', () => {
    expect(leaderboardBidIncrementCents(19999)).toBe(2000) // 1999.9c -> $20
    expect(leaderboardBidIncrementCents(20000)).toBe(2000) // exactly $20
    expect(leaderboardBidIncrementCents(20001)).toBe(2100) // 2000.1c -> $21
  })
})

describe('leaderboardMinTargetCents', () => {
  it('opens an empty board at $6.66', () => {
    expect(leaderboardMinTargetCents(0)).toBe(LEADERBOARD_SPONSOR_OPENING_CENTS)
    // Defensive: a nonsense negative total is still an empty board.
    expect(leaderboardMinTargetCents(-1)).toBe(LEADERBOARD_SPONSOR_OPENING_CENTS)
  })

  it('adds the increment on top of the current #1 total', () => {
    expect(leaderboardMinTargetCents(666)).toBe(766)
    expect(leaderboardMinTargetCents(2350)).toBe(2650)
    // Above $10 top totals the 10% branch takes over from the $1 floor.
    expect(leaderboardMinTargetCents(1001)).toBe(1201)
  })
})

describe('leaderboardMaxTargetCents', () => {
  it('holds the $10,000 fat-finger ceiling while the minimum sits below it', () => {
    expect(leaderboardMaxTargetCents(666)).toBe(LEADERBOARD_SPONSOR_MAX_TARGET_CENTS)
    expect(leaderboardMaxTargetCents(LEADERBOARD_SPONSOR_MAX_TARGET_CENTS)).toBe(
      LEADERBOARD_SPONSOR_MAX_TARGET_CENTS
    )
  })

  it('lifts to the fresh minimum once the board outgrows the cap — min <= max always, the board can never lock', () => {
    // The exact lock scenario: a $9,500 top makes the minimum challenge
    // $10,450 — above the static cap, yet it must stay purchasable.
    const min = leaderboardMinTargetCents(950_000)
    expect(min).toBe(1_045_000)
    expect(leaderboardMaxTargetCents(min)).toBe(1_045_000)
  })

  it('min <= max holds across the growth curve, so a 409 retry at minTargetCents is never ceiling-refused', () => {
    for (const top of [0, 666, 909_100, 950_000, 1_000_000, 2_500_000]) {
      const min = leaderboardMinTargetCents(top)
      expect(leaderboardMaxTargetCents(min)).toBeGreaterThanOrEqual(min)
    }
  })
})

describe('leaderboardChargeCents', () => {
  it('charges the difference to the target', () => {
    expect(leaderboardChargeCents(766, 0)).toBe(766)
    expect(leaderboardChargeCents(766, 300)).toBe(466)
  })

  it('floors small top-ups at the $2 minimum checkout', () => {
    expect(leaderboardChargeCents(766, 700)).toBe(LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS)
    // A single cent of difference still costs the full floor.
    expect(leaderboardChargeCents(701, 700)).toBe(LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS)
  })

  it('charges exactly the difference once it clears the floor — no overshoot', () => {
    expect(leaderboardChargeCents(900, 700)).toBe(200) // exactly $2
    expect(leaderboardChargeCents(901, 700)).toBe(201) // a cent past it
  })

  it('floor-overshoots even past the stated target — what is paid is what counts', () => {
    // A fresh buyer stating a $1 target is still charged the $2 floor;
    // the whole $2 becomes their contribution, not the $1 they aimed at.
    expect(leaderboardChargeCents(100, 0)).toBe(LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS)
  })

  it('returns 0 when the target is already met', () => {
    expect(leaderboardChargeCents(500, 500)).toBe(0)
    expect(leaderboardChargeCents(500, 700)).toBe(0)
  })

  it('cumulative top-ups: each successive checkout charges only the new difference', () => {
    // A sponsor climbing $6.66 -> $10 -> $20 pays 666, then 334, then
    // 1000 — the sum of charges equals the final total, never more.
    const first = leaderboardChargeCents(666, 0)
    const second = leaderboardChargeCents(1000, 666)
    const third = leaderboardChargeCents(2000, 1000)
    expect([first, second, third]).toEqual([666, 334, 1000])
    expect(first + second + third).toBe(2000)
  })
})

describe('rankLeaderboardSponsors', () => {
  const now = Date.parse('2026-08-25T12:00:00Z')
  const hoursAgo = (h: number) => now - h * 3_600_000

  it('sums active contributions per creative and ranks by total', () => {
    const board = rankLeaderboardSponsors(
      [
        { adId: 1, amountCents: 666, paidAtMs: hoursAgo(10) },
        { adId: 2, amountCents: 500, paidAtMs: hoursAgo(5) },
        { adId: 2, amountCents: 400, paidAtMs: hoursAgo(1) }
      ],
      now
    )
    expect(board.map((s) => [s.adId, s.rank, s.activeCents])).toEqual([
      [2, 1, 900],
      [1, 2, 666]
    ])
  })

  it('drops contributions at exactly the 24h boundary', () => {
    const board = rankLeaderboardSponsors(
      [
        { adId: 1, amountCents: 666, paidAtMs: now - LEADERBOARD_SPONSOR_WINDOW_MS },
        { adId: 2, amountCents: 200, paidAtMs: now - LEADERBOARD_SPONSOR_WINDOW_MS + 1 }
      ],
      now
    )
    expect(board.map((s) => s.adId)).toEqual([2])
  })

  it('breaks ties by the earlier first active payment', () => {
    const board = rankLeaderboardSponsors(
      [
        { adId: 5, amountCents: 700, paidAtMs: hoursAgo(2) },
        { adId: 9, amountCents: 700, paidAtMs: hoursAgo(6) }
      ],
      now
    )
    expect(board.map((s) => s.adId)).toEqual([9, 5])
  })

  it('derives next-drop and full-expiry from the contribution clocks', () => {
    const [standing] = rankLeaderboardSponsors(
      [
        { adId: 1, amountCents: 666, paidAtMs: hoursAgo(20) },
        { adId: 1, amountCents: 200, paidAtMs: hoursAgo(2) }
      ],
      now
    )
    expect(standing.activeCents).toBe(866)
    expect(standing.nextDropAtMs).toBe(hoursAgo(20) + LEADERBOARD_SPONSOR_WINDOW_MS)
    expect(standing.expiresAtMs).toBe(hoursAgo(2) + LEADERBOARD_SPONSOR_WINDOW_MS)
  })

  it('returns an empty board for no contributions, and no empty entries for fully expired ones', () => {
    expect(rankLeaderboardSponsors([], now)).toEqual([])
    expect(
      rankLeaderboardSponsors(
        [{ adId: 1, amountCents: 666, paidAtMs: hoursAgo(25) }],
        now
      )
    ).toEqual([])
  })

  it('keeps a payment landing at this exact instant, and one a single ms inside the window', () => {
    const board = rankLeaderboardSponsors(
      [
        // Paid right now: the full 24h lie ahead.
        { adId: 1, amountCents: 666, paidAtMs: now },
        // The oldest still-active contribution possible.
        { adId: 2, amountCents: 700, paidAtMs: now - LEADERBOARD_SPONSOR_WINDOW_MS + 1 }
      ],
      now
    )
    expect(board.map((s) => [s.adId, s.activeCents])).toEqual([
      [2, 700],
      [1, 666]
    ])
    expect(board[0].expiresAtMs).toBe(now + 1)
    expect(board[1].expiresAtMs).toBe(now + LEADERBOARD_SPONSOR_WINDOW_MS)
  })

  it('tie-breaks on the first ACTIVE payment — an expired early payment buys no seniority', () => {
    // A paid long ago (expired) and again 2h ago; B paid once 3h ago.
    // Both hold 500 active, but B's active money arrived first — the
    // dead contribution must not count as A's tie-break evidence.
    const board = rankLeaderboardSponsors(
      [
        { adId: 1, amountCents: 500, paidAtMs: hoursAgo(30) },
        { adId: 1, amountCents: 500, paidAtMs: hoursAgo(2) },
        { adId: 2, amountCents: 500, paidAtMs: hoursAgo(3) }
      ],
      now
    )
    expect(board.map((s) => s.adId)).toEqual([2, 1])
    // The expired row must not pollute A's clocks either.
    expect(board[1].firstPaidAtMs).toBe(hoursAgo(2))
    expect(board[1].nextDropAtMs).toBe(hoursAgo(2) + LEADERBOARD_SPONSOR_WINDOW_MS)
  })

  it('falls back to ad id for a fully tied pair, keeping the order total', () => {
    const board = rankLeaderboardSponsors(
      [
        { adId: 9, amountCents: 500, paidAtMs: hoursAgo(4) },
        { adId: 3, amountCents: 500, paidAtMs: hoursAgo(4) }
      ],
      now
    )
    expect(board.map((s) => [s.adId, s.rank])).toEqual([
      [3, 1],
      [9, 2]
    ])
  })

  it('a refund removes the contribution from the total and re-ranks the board', () => {
    // REFUNDED rows never reach the ranker (callers pass only
    // non-refunded PAID rows) — so a refund IS the row's absence.
    const kept = { adId: 1, amountCents: 666, paidAtMs: hoursAgo(6) }
    const refunded = { adId: 1, amountCents: 400, paidAtMs: hoursAgo(3) }
    const rival = { adId: 2, amountCents: 900, paidAtMs: hoursAgo(5) }

    const before = rankLeaderboardSponsors([kept, refunded, rival], now)
    expect(before.map((s) => [s.adId, s.activeCents])).toEqual([
      [1, 1066],
      [2, 900]
    ])

    const after = rankLeaderboardSponsors([kept, rival], now)
    expect(after.map((s) => [s.adId, s.activeCents])).toEqual([
      [2, 900],
      [1, 666]
    ])
  })

  it('refunding every contribution takes the sponsor off the board entirely', () => {
    const rival = { adId: 2, amountCents: 900, paidAtMs: hoursAgo(5) }
    const board = rankLeaderboardSponsors([rival], now)
    expect(board.map((s) => s.adId)).toEqual([2])
  })

  it('the pricing chain and the ranker agree: a priced-up challenger lands at #1', () => {
    // The full story: ad 2 holds $10, ad 4 sits at $3. Ad 4 buys the
    // fresh minimum target; the charge is the difference; once that
    // payment lands, the ranker seats ad 4 at #1 with exactly the
    // target total. Pricing and ranking share one definition of money.
    const holder = { adId: 2, amountCents: 1000, paidAtMs: hoursAgo(5) }
    const challengerSeed = { adId: 4, amountCents: 300, paidAtMs: hoursAgo(4) }

    const minTarget = leaderboardMinTargetCents(1000)
    expect(minTarget).toBe(1100)
    const charge = leaderboardChargeCents(minTarget, 300)
    expect(charge).toBe(800)

    const board = rankLeaderboardSponsors(
      [holder, challengerSeed, { adId: 4, amountCents: charge, paidAtMs: now }],
      now
    )
    expect(board.map((s) => [s.adId, s.rank, s.activeCents])).toEqual([
      [4, 1, minTarget],
      [2, 2, 1000]
    ])
  })
})

describe('classifySponsorRun', () => {
  const lastPaidAt = Date.parse('2026-08-25T12:00:00Z')
  const windowEnds = lastPaidAt + LEADERBOARD_SPONSOR_WINDOW_MS
  const graceEnds = windowEnds + LEADERBOARD_SPONSOR_GRACE_MS

  it('never paid (null) is bidding_open, whatever the clock says', () => {
    expect(classifySponsorRun(null, lastPaidAt)).toBe('bidding_open')
    expect(classifySponsorRun(null, lastPaidAt + 365 * 24 * 3_600_000)).toBe(
      'bidding_open'
    )
  })

  it('is live from the payment instant until the last ms of the window', () => {
    expect(classifySponsorRun(lastPaidAt, lastPaidAt)).toBe('live')
    expect(classifySponsorRun(lastPaidAt, windowEnds - 1)).toBe('live')
  })

  it('flips to run_complete at exactly the window boundary — the same instant the ranker drops the contribution', () => {
    expect(classifySponsorRun(lastPaidAt, windowEnds)).toBe('run_complete')
    // The consistency the admin buckets rest on: the moment the board
    // loses the creative, the classifier already says run_complete.
    expect(
      rankLeaderboardSponsors(
        [{ adId: 1, amountCents: 666, paidAtMs: lastPaidAt }],
        windowEnds
      )
    ).toEqual([])
    expect(
      rankLeaderboardSponsors(
        [{ adId: 1, amountCents: 666, paidAtMs: lastPaidAt }],
        windowEnds - 1
      )
    ).toHaveLength(1)
  })

  it('stays run_complete through the last ms of the grace period', () => {
    expect(classifySponsorRun(lastPaidAt, graceEnds - 1)).toBe('run_complete')
  })

  it('is finished at exactly window + grace and forever after', () => {
    expect(classifySponsorRun(lastPaidAt, graceEnds)).toBe('finished')
    expect(classifySponsorRun(lastPaidAt, graceEnds + 24 * 3_600_000)).toBe('finished')
  })

  it('a future paid_at (clock skew) still reads as live, never as a negative-age artifact', () => {
    expect(classifySponsorRun(lastPaidAt + 60_000, lastPaidAt)).toBe('live')
  })

  it('the grace period is 24h, matching the product spec', () => {
    expect(LEADERBOARD_SPONSOR_GRACE_MS).toBe(24 * 3_600_000)
  })
})

describe('flip cadence and pricing constants', () => {
  it('matches the product spec: stats 8s, sponsor 6s, ~450ms flips, 15s polling', () => {
    expect(LEADERBOARD_FLIP_STATS_HOLD_MS).toBe(8_000)
    expect(LEADERBOARD_FLIP_SPONSOR_HOLD_MS).toBe(6_000)
    expect(LEADERBOARD_FLIP_TRANSITION_MS).toBe(450)
    expect(LEADERBOARD_SPONSOR_POLL_MS).toBe(15_000)
  })

  it('one full rotation fits inside a poll interval, so a fresh #1 shows within a cycle', () => {
    const fullCycle =
      LEADERBOARD_FLIP_STATS_HOLD_MS +
      LEADERBOARD_FLIP_SPONSOR_HOLD_MS +
      2 * LEADERBOARD_FLIP_TRANSITION_MS
    expect(fullCycle).toBeLessThanOrEqual(LEADERBOARD_SPONSOR_POLL_MS)
  })

  it('pins the money constants the routes and UI both trust', () => {
    expect(LEADERBOARD_SPONSOR_OPENING_CENTS).toBe(666)
    expect(LEADERBOARD_SPONSOR_MIN_CHECKOUT_CENTS).toBe(200)
    expect(LEADERBOARD_SPONSOR_MAX_TARGET_CENTS).toBe(1_000_000)
    expect(LEADERBOARD_SPONSOR_MIN_INCREMENT_CENTS).toBe(100)
    expect(LEADERBOARD_SPONSOR_INCREMENT_RATE).toBe(0.1)
    expect(LEADERBOARD_SPONSOR_WINDOW_MS).toBe(24 * 3_600_000)
    // Polar hosted checkouts expire ~1h after creation; the pending TTL
    // must comfortably outlast that so a live checkout is never treated
    // as abandoned.
    expect(LEADERBOARD_SPONSOR_PENDING_TTL_MS).toBe(2 * 3_600_000)
  })
})

describe('formatSponsorUsd', () => {
  it('keeps cents when non-zero and drops them on round dollars', () => {
    expect(formatSponsorUsd(666)).toBe('$6.66')
    expect(formatSponsorUsd(20000)).toBe('$200')
    expect(formatSponsorUsd(5)).toBe('$0.05')
    expect(formatSponsorUsd(0)).toBe('$0')
  })

  it('adds thousands separators up to the $10,000 target ceiling', () => {
    expect(formatSponsorUsd(123450)).toBe('$1,234.50')
    expect(formatSponsorUsd(LEADERBOARD_SPONSOR_MAX_TARGET_CENTS)).toBe('$10,000')
  })
})
