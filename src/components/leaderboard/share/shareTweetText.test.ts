import { describe, expect, it } from 'vitest'
import { shareTweetText } from './shareTweetText'

const LINK = 'https://cribble.dev/join/CRIB-K4T9-XR27'

describe('shareTweetText', () => {
  it('lays out own medal cards as rank hashtag, quoted pts, cta, link', () => {
    expect(
      shareTweetText({
        variant: 'medal',
        isOwn: true,
        username: 'birdabo',
        rank: 13,
        score: 1231,
        link: LINK
      })
    ).toBe(
      `#13 on cribble\n\n> 1,231 pts\n\njoin me. outrank me.\n${LINK}`
    )
  })

  it('names the other pilot on someone else\'s medal card', () => {
    const text = shareTweetText({
      variant: 'medal',
      isOwn: false,
      username: 'ziad',
      rank: 4,
      score: 88000,
      link: LINK
    })
    expect(text.startsWith('#4 @ziad on cribble\n')).toBe(true)
    expect(text).toContain('> 88,000 pts')
    expect(text).toContain('join me. get on the board.')
    expect(text.endsWith(LINK)).toBe(true)
  })

  it('uses the burn CTA and quoted token line on own ember cards', () => {
    expect(
      shareTweetText({
        variant: 'ember',
        isOwn: true,
        username: 'birdabo',
        rank: 2,
        score: 1.12e11,
        totalTokens: '112000000000',
        costUsd: '86701.23',
        link: LINK
      })
    ).toBe(
      `#2 on cribble's burn board\n\n> 112B tokens torched · $86,701\n\njoin me. burn whatever.\n${LINK}`
    )
  })

  it('drops the USD clause when burn cost is missing or zero', () => {
    const noCost = shareTweetText({
      variant: 'ember',
      isOwn: false,
      username: 'pilot',
      rank: 9,
      score: 4400,
      totalTokens: '4400',
      link: LINK
    })
    expect(noCost).toContain('> 4.4k tokens torched\n')
    expect(noCost).not.toContain('$')
    expect(noCost).toContain('join me. burn with us.')
    expect(noCost.startsWith('#9 @pilot on cribble\'s burn board\n')).toBe(true)
  })
})
