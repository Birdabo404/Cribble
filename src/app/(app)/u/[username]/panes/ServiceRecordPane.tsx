// SERVICE RECORD pane — unlocked decorations on paper, grouped by rarity
// from mythic down to common so the rarest sit on top. Full-width rows
// give each badge its name and description. Each group header is a
// rarity-inked pf-label with a wing rule and its count; each badge tile
// is a 40px square whose 1px border is currentColor at the rarity ink
// (rarityInk), around the untouched PixelIcon. The rarity stamp on the
// right (sm+) is the same ink. The pane title and the `n / total` aside
// live in the content column's PanelHeader (paneAside).

import { Fragment } from 'react'
import Link from 'next/link'
import { PixelIcon } from '@/components/achievements/PixelIcon'
import type { PublicProfileData } from '@/types/profile'
import { LockedPanel, rarityInk, Stamp } from '../parts'

type Badge = PublicProfileData['badges'][number]

const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'common'] as const

/** Badges bucketed by rarity in RARITY_ORDER; a rarity the client has never
 *  heard of (newer server) still renders, after the known groups. */
function groupByRarity(badges: Badge[]): [string, Badge[]][] {
  const groups = new Map<string, Badge[]>()
  for (const badge of badges) {
    const list = groups.get(badge.rarity)
    if (list) list.push(badge)
    else groups.set(badge.rarity, [badge])
  }
  const order = (rarity: string) => {
    const i = (RARITY_ORDER as readonly string[]).indexOf(rarity)
    return i === -1 ? RARITY_ORDER.length : i
  }
  return [...groups.entries()].sort(([a], [b]) => order(a) - order(b))
}

export function ServiceRecordPane({ profile, isYou }: { profile: PublicProfileData; isYou: boolean }) {
  const { badges } = profile

  return (
    <div className="px-[var(--pf-gutter)] py-5">
      {profile.restricted ? (
        <LockedPanel hint={`Follow @${profile.username} to see their decorations.`} />
      ) : badges.length === 0 ? (
        <div className="pf-micro py-4 text-center">NO DECORATIONS YET</div>
      ) : (
        <div>
          {/* flat list: headers and rows are siblings so first:mt-0 hits
              only the top group header */}
          {groupByRarity(badges).map(([rarity, group]) => {
            const ink = rarityInk(rarity)
            return (
              <Fragment key={rarity}>
                <div className="pf-row mt-6 flex items-center gap-3 first:mt-0">
                  <span className="pf-label shrink-0" style={{ color: ink }}>
                    {rarity.toUpperCase()}
                  </span>
                  <div aria-hidden className="pf-rule flex-1" />
                  <span className="pf-micro shrink-0 tabular-nums">{group.length}</span>
                </div>
                {group.map((badge) => (
                  <div
                    key={badge.id}
                    title={`${badge.name} — ${badge.description}`}
                    className="pf-row flex items-center gap-3 border-b border-[color:var(--pf-line-soft)] py-2.5 transition-colors hover:bg-[color:var(--pf-paper-3)]"
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center border border-current"
                      style={{ color: ink }}
                    >
                      <PixelIcon name={badge.icon} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[13px] font-medium">{badge.name}</span>
                      <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--pf-ink-2)' }}>
                        {badge.description}
                      </span>
                    </span>
                    {/* group header already names the rarity; the stamp is sm+ garnish */}
                    <Stamp ink={ink} className="hidden shrink-0 sm:inline-flex">
                      {rarity.toUpperCase()}
                    </Stamp>
                  </div>
                ))}
              </Fragment>
            )
          })}
        </div>
      )}

      {isYou && (
        <Link
          href="/dashboard/achievements"
          className="pf-micro mt-4 flex min-h-11 items-center justify-center transition-colors hover:text-[color:var(--pf-ink)]"
        >
          VIEW FULL SERVICE RECORD →
        </Link>
      )}
    </div>
  )
}
