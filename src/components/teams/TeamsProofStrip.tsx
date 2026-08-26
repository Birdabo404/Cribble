'use client'

// The proof strip — what an approved team actually looks like, built from
// the SAME components the product renders with (Avatar's square company
// treatment, TeamBadge, TeamMiniLogo, VerifiedBadge). No screenshots, no
// mock art: if the real components change, this page changes with them.
//
// The specimens are display-only. Faces are local /avatars mirrors of the
// real X profiles — never hotlinked.

import { Avatar } from '@/components/leaderboard/Avatar'
import { TeamBadge } from '@/components/premium/TeamBadge'
import { TeamMiniLogo, type TeamRef } from '@/components/premium/TeamMiniLogo'
import { VerifiedBadge } from '@/components/premium/VerifiedBadge'
import { GoldPanel, SectionHead } from './chrome'

// React 18 renders unknown string-valued props as literal DOM attributes,
// so `inert=""` lands in the markup and browsers disable the subtree
// (clicks, focus, a11y tree) — the typed boolean prop only exists from
// React 19. Keeps TeamMiniLogo's real <a> from tabbing anywhere.
const INERT = { inert: '' } as unknown as React.HTMLAttributes<HTMLDivElement>

/** House team — @cribble_ai, the account that actually flies colors. */
const DEMO_TEAM: TeamRef = {
  username: 'cribble_ai',
  name: 'CRIBBLE 🫆',
  logo: '/avatars/cribble_ai.jpg'
}

interface DemoPilot {
  rank: number
  name: string
  handle: string
  avatar: string | null
  score: string
  affiliate: boolean
}

const DEMO_PILOTS: DemoPilot[] = [
  {
    rank: 12,
    name: 'emma ☆',
    handle: 'emzerielo',
    avatar: '/avatars/emzerielo.jpg',
    score: '48,102',
    affiliate: true
  },
  {
    rank: 13,
    name: 'ius',
    handle: 'rice4o4',
    avatar: '/avatars/rice4o4.jpg',
    score: '46,377',
    affiliate: true
  }
]

/** Board-row specimen — the leaderboard's row anatomy: pixel rank, round
 *  pilot avatar, callsign with its badge lockup, signal-lime score. */
function BoardRow({ pilot }: { pilot: DemoPilot }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[11px] tabular-nums text-zinc-500 [font-family:var(--font-pixel)]">
        {pilot.rank}
      </span>
      <Avatar
        src={pilot.avatar}
        char={pilot.name[0] ?? '?'}
        imgClassName="h-9 w-9 shrink-0 rounded-full border border-zinc-800 object-cover"
        fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-display text-[11px] text-zinc-400"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-display text-[13px] font-medium tracking-tight text-zinc-100">
          {pilot.name}
        </span>
        {pilot.affiliate && (
          <>
            <VerifiedBadge size={14} />
            <TeamMiniLogo team={DEMO_TEAM} size={14} />
          </>
        )}
        <span className="hidden shrink-0 text-[10px] text-zinc-600 sm:inline">
          @{pilot.handle}
        </span>
      </span>
      <span
        className="shrink-0 text-[13px] leading-none tabular-nums [font-family:var(--font-pixel)]"
        style={{
          color: 'rgb(var(--lb-score))',
          textShadow: '0 0 10px rgb(var(--lb-score) / 0.22)'
        }}
      >
        {pilot.score}
      </span>
    </div>
  )
}

export function TeamsProofStrip() {
  return (
    <section className="tm-reveal" style={{ ['--rv' as string]: '140ms' }}>
      <SectionHead label="THE MARK" note="RENDERED BY THE LIVE COMPONENTS" />
      <GoldPanel>
        <div className="grid md:grid-cols-2 md:divide-x md:divide-white/[0.05]">
          {/* ---- the company account, as its profile draws it ---- */}
          <div className="p-5 md:p-6">
            <span className="text-[9px] tracking-[0.35em] text-zinc-500">
              THE COMPANY ACCOUNT
            </span>
            <div aria-hidden {...INERT} className="mt-4 flex items-center gap-3.5">
              <Avatar
                src={DEMO_TEAM.logo}
                char={DEMO_TEAM.name[0] ?? '?'}
                imgClassName="h-12 w-12 shrink-0 rounded-md border border-[rgb(var(--lb-gold)/0.45)] object-cover"
                fallbackClassName="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[rgb(var(--lb-gold)/0.45)] bg-zinc-900 font-display text-[17px] font-semibold text-zinc-100"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-display text-base font-semibold tracking-tight text-zinc-50">
                    {DEMO_TEAM.name}
                  </span>
                  <TeamBadge size={16} />
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">@{DEMO_TEAM.username}</div>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
              Square avatar, gold seal. The account is the team — its profile is the
              company page.
            </p>
          </div>

          {/* ---- an affiliate's board row, badge lockup intact ---- */}
          <div className="border-t border-white/[0.05] p-5 md:border-t-0 md:p-6">
            <span className="text-[9px] tracking-[0.35em] text-zinc-500">
              EVERY AFFILIATE&apos;S ROW
            </span>
            <div aria-hidden {...INERT} className="lb-inset mt-4 divide-y divide-white/[0.04] overflow-hidden rounded-xl">
              {DEMO_PILOTS.map((pilot) => (
                <BoardRow key={pilot.handle} pilot={pilot} />
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
              Your logo rides next to their own blue check — square, clickable, straight
              through to the team.
            </p>
          </div>
        </div>
      </GoldPanel>
    </section>
  )
}
