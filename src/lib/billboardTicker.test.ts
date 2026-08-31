import { describe, expect, it } from 'vitest'
import {
  BILLBOARD_AD_HOLD_MS,
  BILLBOARD_AD_SHOW_FOR_MS,
  BILLBOARD_AD_SOLO_REPLAY_MS,
  BILLBOARD_HYPE_HOLD_MS,
  BILLBOARD_HYPE_SHOW_FOR_MS,
  BURN_HYPE_TIER_THEME,
  HYPE_LADDER_MAX_RUNGS,
  HYPE_TIER_THEME,
  billboardBurnUsdLabel,
  billboardChrome,
  billboardClubSentence,
  billboardHoldMs,
  billboardHypeSentence,
  billboardRankClimb,
  billboardShouldCloseAfterHold,
  billboardShowForMs,
  billboardStageTheme,
  hypeRankLadder,
  isAnnouncementOnly
} from './billboard'
import type {
  BillboardClubItem,
  BillboardHypeItem,
  BillboardHypeVictim,
  BillboardItem
} from './billboard'

// Tier falls out of the landing rank, so a fixture can't tell a
// mismatched rank/tier story: rank 1 is a throne take, 2-3 a TOP 3
// breakthrough, anything deeper TOP 10.
const hype = (userId: number, rank = 2, prevRank = 7): BillboardHypeItem => ({
  kind: 'hype',
  id: userId,
  board: 'score',
  tier: rank === 1 ? 'throne' : rank <= 3 ? 'top3' : 'top10',
  userId,
  username: `pilot${userId}`,
  displayName: null,
  avatarUrl: null,
  rank,
  prevRank,
  movedAt: '2026-08-21T00:00:00.000Z',
  burnUsd: null
})

const victim = (username: string): BillboardHypeVictim => ({
  username,
  displayName: null,
  avatarUrl: null
})

const club = (userId: number, threshold = 100_000): BillboardClubItem => ({
  kind: 'club',
  id: 100 + userId,
  board: 'score',
  userId,
  username: `pilot${userId}`,
  displayName: null,
  avatarUrl: null,
  threshold,
  reachedAt: '2026-08-21T00:00:00.000Z'
})

// The burn twins: the same shapes on board 'burn' — hype carries the
// celebrant's season burn (exact decimal string, non-null by the API
// contract), clubs a whole-USD threshold off the persona ladder.
const burnHype = (
  userId: number,
  rank = 2,
  prevRank = 7,
  burnUsd = '412.5'
): BillboardHypeItem => ({ ...hype(userId, rank, prevRank), board: 'burn', burnUsd })

const burnClub = (userId: number, threshold = 2_500): BillboardClubItem => ({
  ...club(userId, threshold),
  board: 'burn'
})

const ad = (id: number): BillboardItem => ({
  kind: 'ad',
  id,
  text: 'Ship faster',
  companyName: 'Acme',
  linkHost: 'acme.dev',
  logoUrl: null,
  accentColor: null
})

const announce = (id: number): BillboardItem => ({
  kind: 'announce',
  id,
  headline: 'Season two is live',
  body: 'Fresh board, fresh ranks — the climb starts now.',
  linkUrl: null
})

describe('isAnnouncementOnly', () => {
  it('is true only when every item is hype', () => {
    expect(isAnnouncementOnly([hype(1)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), hype(2), hype(3)])).toBe(true)
    expect(isAnnouncementOnly([hype(1), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([ad(10)])).toBe(false)
  })

  it('counts operator announcements as announcements, alone or mixed with hype', () => {
    expect(isAnnouncementOnly([announce(1)])).toBe(true)
    expect(isAnnouncementOnly([announce(1), hype(2), hype(3)])).toBe(true)
  })

  it('counts club events as announcements, alone or mixed with hype and announce', () => {
    expect(isAnnouncementOnly([club(1)])).toBe(true)
    expect(isAnnouncementOnly([club(1), hype(2)])).toBe(true)
    expect(isAnnouncementOnly([announce(1), hype(2), club(3)])).toBe(true)
  })

  it('is false once an ad boards an announce train', () => {
    expect(isAnnouncementOnly([announce(1), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([announce(1), hype(2), ad(10)])).toBe(false)
    expect(isAnnouncementOnly([club(1), ad(10)])).toBe(false)
  })

  it('is false for an empty train', () => {
    expect(isAnnouncementOnly([])).toBe(false)
  })
})

describe('billboardHoldMs', () => {
  it('gives hype its announcement beat, solo or not — never the solo-ad replay cadence', () => {
    expect(billboardHoldMs(hype(1), true)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(hype(1), false)).toBe(BILLBOARD_HYPE_HOLD_MS)
    // Distinct constants keep the two assertions above discriminating.
    // The beat itself may outlast the solo replay cadence: what keeps
    // free hype short of a sponsor's airtime is the one-pass close, so
    // even a full pass of the API's max train ends inside one
    // sponsored show.
    expect(BILLBOARD_HYPE_HOLD_MS).not.toBe(BILLBOARD_AD_SOLO_REPLAY_MS)
    expect(billboardShowForMs([hype(1), hype(2), hype(3)])).toBeLessThan(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('holds a multi-train ad for the full rotation and a solo ad for the replay cadence', () => {
    expect(billboardHoldMs(ad(10), true)).toBe(BILLBOARD_AD_HOLD_MS)
    expect(billboardHoldMs(ad(10), false)).toBe(BILLBOARD_AD_SOLO_REPLAY_MS)
  })

  it('gives an operator announcement the hype beat, solo or not', () => {
    expect(billboardHoldMs(announce(1), true)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(announce(1), false)).toBe(BILLBOARD_HYPE_HOLD_MS)
  })

  it('gives a club event the hype beat, solo or not — never the solo-ad replay cadence', () => {
    expect(billboardHoldMs(club(1), true)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(club(1), false)).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardHoldMs(club(1), false)).not.toBe(BILLBOARD_AD_SOLO_REPLAY_MS)
  })
})

describe('billboardShowForMs', () => {
  it('any paid ad buys the full sponsored show', () => {
    expect(billboardShowForMs([ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
    expect(billboardShowForMs([hype(1), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
    expect(billboardShowForMs([hype(1), hype(2), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('announcement-only trains get one hold per item', () => {
    expect(billboardShowForMs([hype(1)])).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([hype(1), hype(2)])).toBe(2 * BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([hype(1), hype(2), hype(3)])).toBe(3 * BILLBOARD_HYPE_HOLD_MS)
  })

  it('operator announcements ride the same free-copy math — an ad aboard still buys the loop', () => {
    expect(billboardShowForMs([announce(1)])).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([announce(1), hype(2)])).toBe(2 * BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([announce(1), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('club events ride the same free-copy math — an ad aboard still buys the loop', () => {
    expect(billboardShowForMs([club(1)])).toBe(BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([club(1), hype(2), announce(3)])).toBe(3 * BILLBOARD_HYPE_HOLD_MS)
    expect(billboardShowForMs([club(1), ad(10)])).toBe(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('caps announcement-only shows at the hype ceiling', () => {
    const six = [hype(1), hype(2), hype(3), hype(4), hype(5), hype(6)]
    expect(billboardShowForMs(six)).toBe(BILLBOARD_HYPE_SHOW_FOR_MS)
    expect(BILLBOARD_HYPE_SHOW_FOR_MS).toBeLessThan(BILLBOARD_AD_SHOW_FOR_MS)
  })

  it('fits a full pass of the API max (3 hype items) inside the ceiling', () => {
    expect(3 * BILLBOARD_HYPE_HOLD_MS).toBeLessThanOrEqual(BILLBOARD_HYPE_SHOW_FOR_MS)
  })
})

describe('billboardChrome', () => {
  it('labels hype as an announcement, not a sponsor', () => {
    expect(billboardChrome(hype(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
  })

  it('keeps the sponsor chrome for paid ads', () => {
    expect(billboardChrome(ad(10))).toEqual({ label: 'SPONSOR', ariaLabel: 'Sponsorship' })
  })

  it('labels an operator announcement as an announcement, never a sponsor', () => {
    expect(billboardChrome(announce(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
  })

  it('labels a club event as an announcement, never a sponsor', () => {
    expect(billboardChrome(club(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
  })

  it('keeps the announcement chrome for burn items — the board never re-dresses the label', () => {
    expect(billboardChrome(burnHype(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
    expect(billboardChrome(burnClub(1))).toEqual({
      label: 'ANNOUNCEMENT',
      ariaLabel: 'Announcement'
    })
  })
})

describe('billboardRankClimb', () => {
  it('derives from/to/places from the item', () => {
    expect(billboardRankClimb(hype(1, 2, 7))).toEqual({ from: 7, to: 2, places: 5 })
    expect(billboardRankClimb(hype(1, 3, 4))).toEqual({ from: 4, to: 3, places: 1 })
    expect(billboardRankClimb(hype(1, 1, 50))).toEqual({ from: 50, to: 1, places: 49 })
  })

  it('clamps a non-climb to zero places instead of going negative', () => {
    expect(billboardRankClimb(hype(1, 3, 3)).places).toBe(0)
    expect(billboardRankClimb(hype(1, 3, 2)).places).toBe(0)
  })
})

describe('hypeRankLadder', () => {
  it('steps every rank on short climbs, from first and to last', () => {
    expect(hypeRankLadder(7, 2)).toEqual([7, 6, 5, 4, 3, 2])
    expect(hypeRankLadder(4, 3)).toEqual([4, 3])
  })

  it('resolves a non-climb straight to the landing', () => {
    expect(hypeRankLadder(2, 2)).toEqual([2])
    expect(hypeRankLadder(1, 3)).toEqual([3])
  })

  it('starts compressing exactly past a full ladder', () => {
    // span 7 still fits the cap uncompressed; span 8 is the first squeeze.
    expect(hypeRankLadder(9, 2)).toEqual([9, 8, 7, 6, 5, 4, 3, 2])
    expect(hypeRankLadder(10, 2)).toHaveLength(HYPE_LADDER_MAX_RUNGS)
  })

  it('compresses freak jumps to the rung cap with exact endpoints, strictly descending', () => {
    for (const [from, to] of [
      [120, 1],
      [50, 3],
      [11, 2]
    ]) {
      const ladder = hypeRankLadder(from, to)
      expect(ladder).toHaveLength(HYPE_LADDER_MAX_RUNGS)
      expect(ladder[0]).toBe(from)
      expect(ladder[ladder.length - 1]).toBe(to)
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]).toBeLessThan(ladder[i - 1])
      }
    }
  })
})

describe('billboardHypeSentence', () => {
  it('prefers the display name', () => {
    expect(billboardHypeSentence({ ...hype(1, 2, 7), displayName: 'SUI' })).toBe(
      'SUI climbed from rank 7 to rank 2'
    )
  })

  it('falls back to the username', () => {
    expect(billboardHypeSentence(hype(1, 3, 9))).toBe('pilot1 climbed from rank 9 to rank 3')
  })

  it('tells a throne take as taking rank 1, not a climb', () => {
    expect(billboardHypeSentence(hype(1, 1, 4))).toBe('pilot1 took rank 1')
    expect(billboardHypeSentence(hype(1, 1, 50))).toBe('pilot1 took rank 1')
  })

  it('names the dethroned on a throne take exactly when a victim rides along', () => {
    expect(billboardHypeSentence({ ...hype(1, 1, 4), victim: victim('oldking') })).toBe(
      'pilot1 took rank 1 from oldking'
    )
    expect(billboardHypeSentence({ ...hype(1, 1, 4), victim: null })).toBe('pilot1 took rank 1')
  })

  it('appends the derank callout on top3 and top10 climbs carrying a victim', () => {
    expect(billboardHypeSentence({ ...hype(1, 3, 9), victim: victim('fallen') })).toBe(
      'pilot1 climbed from rank 9 to rank 3, deranking fallen'
    )
    expect(billboardHypeSentence({ ...hype(1, 8, 14), victim: victim('fallen') })).toBe(
      'pilot1 climbed from rank 14 to rank 8, deranking fallen'
    )
  })

  it("prefers the victim's display name like the climber's", () => {
    expect(
      billboardHypeSentence({
        ...hype(1, 1, 4),
        victim: { ...victim('oldking'), displayName: 'The Old King' }
      })
    ).toBe('pilot1 took rank 1 from The Old King')
  })

  it('tells a burn throne take as taking the top burner spot', () => {
    expect(billboardHypeSentence(burnHype(1, 1, 4))).toBe('pilot1 took the top burner spot')
    expect(billboardHypeSentence({ ...burnHype(1, 1, 4), victim: victim('oldking') })).toBe(
      'pilot1 took the top burner spot from oldking'
    )
  })

  it('tells burn climbs in Burn Board language, outburning the victim', () => {
    expect(billboardHypeSentence(burnHype(1, 3, 9))).toBe(
      'pilot1 burned from rank 9 to rank 3'
    )
    expect(billboardHypeSentence({ ...burnHype(1, 8, 14), victim: victim('fallen') })).toBe(
      'pilot1 burned from rank 14 to rank 8, outburning fallen'
    )
  })
})

describe('billboardClubSentence', () => {
  it('names the milestone with its compact label', () => {
    expect(billboardClubSentence(club(1, 100_000))).toBe('pilot1 joined the 100K club')
    expect(billboardClubSentence(club(1, 250_000))).toBe('pilot1 joined the 250K club')
    expect(billboardClubSentence(club(1, 1_000_000))).toBe('pilot1 joined the 1M club')
  })

  it('prefers the display name', () => {
    expect(billboardClubSentence({ ...club(1), displayName: 'SUI' })).toBe(
      'SUI joined the 100K club'
    )
  })

  it('tells a burn club as torching past the dollar label', () => {
    expect(billboardClubSentence(burnClub(1, 2_500))).toBe('pilot1 torched past $2.5K')
    expect(billboardClubSentence(burnClub(1, 100))).toBe('pilot1 torched past $100')
    expect(billboardClubSentence({ ...burnClub(1), displayName: 'SUI' })).toBe(
      'SUI torched past $2.5K'
    )
  })
})

describe('billboardStageTheme', () => {
  it('dispatches each rank tier to its theme: throne on the hot gold, top10 on silver', () => {
    expect(billboardStageTheme(hype(1, 1, 4))).toBe(HYPE_TIER_THEME.throne)
    expect(billboardStageTheme(hype(1, 1, 4)).accentVar).toBe('--lb-gold-hi')
    expect(billboardStageTheme(hype(1, 2, 7))).toBe(HYPE_TIER_THEME.top3)
    expect(billboardStageTheme(hype(1, 2, 7)).accentVar).toBe('--lb-gold')
    expect(billboardStageTheme(hype(1, 8, 14))).toBe(HYPE_TIER_THEME.top10)
    expect(billboardStageTheme(hype(1, 8, 14)).accentVar).toBe('--lb-silver')
  })

  it('builds club themes from the threshold, on the score lime', () => {
    const theme = billboardStageTheme(club(1, 100_000))
    expect(theme.accentVar).toBe('--lb-score')
    expect(theme.marquee).toBe('100K CLUB')
    expect(theme.accentWord).toBe('100K CLUB')
    expect(theme.kineticWords).toEqual(['just', 'joined', 'the'])
    expect(billboardStageTheme(club(1, 1_000_000)).marquee).toBe('1M CLUB')
  })

  it('dispatches burn rank tiers to the ember ladder, hot to coal', () => {
    expect(billboardStageTheme(burnHype(1, 1, 4))).toBe(BURN_HYPE_TIER_THEME.throne)
    expect(billboardStageTheme(burnHype(1, 1, 4)).accentVar).toBe('--lb-ember-hi')
    expect(billboardStageTheme(burnHype(1, 2, 7))).toBe(BURN_HYPE_TIER_THEME.top3)
    expect(billboardStageTheme(burnHype(1, 2, 7)).accentVar).toBe('--lb-ember')
    expect(billboardStageTheme(burnHype(1, 8, 14))).toBe(BURN_HYPE_TIER_THEME.top10)
    expect(billboardStageTheme(burnHype(1, 8, 14)).accentVar).toBe('--lb-ember-lo')
  })

  it('builds burn club themes with the torched marquee on the hot ember', () => {
    const theme = billboardStageTheme(burnClub(1, 2_500))
    expect(theme.accentVar).toBe('--lb-ember-hi')
    expect(theme.marquee).toBe('$2.5K TORCHED')
    expect(theme.accentWord).toBe('$2.5K')
    expect(theme.kineticWords).toEqual(['just', 'torched'])
    expect(billboardStageTheme(burnClub(1, 100)).marquee).toBe('$100 TORCHED')
    expect(billboardStageTheme(burnClub(1, 25_000)).accentWord).toBe('$25K')
  })
})

describe('billboardBurnUsdLabel', () => {
  it('floors to whole dollars and compacts from four digits', () => {
    expect(billboardBurnUsdLabel('412.5')).toBe('$412')
    expect(billboardBurnUsdLabel('0.07')).toBe('$0')
    expect(billboardBurnUsdLabel('999')).toBe('$999')
    expect(billboardBurnUsdLabel('2534')).toBe('$2.5K')
    expect(billboardBurnUsdLabel('25000')).toBe('$25K')
    expect(billboardBurnUsdLabel('1250000')).toBe('$1.3M')
  })

  it('nulls out malformed or negative figures instead of flaunting them', () => {
    expect(billboardBurnUsdLabel('')).toBeNull()
    expect(billboardBurnUsdLabel('not-money')).toBeNull()
    expect(billboardBurnUsdLabel('-5')).toBeNull()
  })
})

describe('billboardShouldCloseAfterHold', () => {
  it('closes an announcement-only train after its last item, including solo', () => {
    expect(billboardShouldCloseAfterHold([hype(1)], 0)).toBe(true)
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 2)).toBe(true)
  })

  it('does not close mid-pass', () => {
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), hype(2), hype(3)], 1)).toBe(false)
  })

  it('closes announce-only and mixed announce+hype trains after one pass, like hype', () => {
    expect(billboardShouldCloseAfterHold([announce(1)], 0)).toBe(true)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 2)).toBe(true)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([announce(1), hype(2), hype(3)], 1)).toBe(false)
  })

  it('closes club-only and mixed club trains after one pass, like hype', () => {
    expect(billboardShouldCloseAfterHold([club(1)], 0)).toBe(true)
    expect(billboardShouldCloseAfterHold([hype(1), club(2), announce(3)], 2)).toBe(true)
    expect(billboardShouldCloseAfterHold([hype(1), club(2), announce(3)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), club(2), announce(3)], 1)).toBe(false)
  })

  it('never closes a train carrying a paid ad — the sponsored loop owns the clock', () => {
    expect(billboardShouldCloseAfterHold([ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 0)).toBe(false)
    expect(billboardShouldCloseAfterHold([hype(1), ad(10)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([ad(10), ad(11)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([announce(1), ad(10)], 1)).toBe(false)
    expect(billboardShouldCloseAfterHold([club(1), ad(10)], 1)).toBe(false)
  })
})
