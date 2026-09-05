'use client'

// The banner plate. The upload (SafeBannerImg, with the owner's saved
// crop) renders untouched — its own colours in both materials, no
// filter, no screen; only the frame around it belongs to the page. The
// host is .pf-photo, the motion hook's target for the boot fade-in. No
// banner: hatched --pf-paper-2 under the 24px drafting grid drawn in ink
// at 6% (the grid sits under the image when there is one). The rank
// watermark is the pixel face at 10% ink, over the plate. The owner's
// EDIT BANNER is a framed chip on paper, lifted above the image (z-10)
// and given a 44px phone hit area by the after: box. 140px below lg,
// 176px from lg.

import { SafeBannerImg } from '@/components/leaderboard/Avatar'
import type { PublicProfileData } from '@/types/profile'
import { PATH_EDIT, Stroke } from './parts'

const GRID_LINES = [
  'repeating-linear-gradient(90deg, rgb(var(--pf-ink-rgb) / 0.06) 0 1px, transparent 1px 24px)',
  'repeating-linear-gradient(0deg, rgb(var(--pf-ink-rgb) / 0.06) 0 1px, transparent 1px 24px)'
].join(', ')

export function HalftoneBanner({
  profile,
  isYou,
  onEdit,
  className = ''
}: {
  profile: Pick<PublicProfileData, 'banner_image' | 'banner_frame' | 'rank'>
  isYou: boolean
  onEdit: () => void
  className?: string
}) {
  return (
    <div
      className={`pf-panel pf-photo h-[140px] overflow-hidden lg:h-[176px] ${className}`}
      style={{ background: 'var(--pf-paper-2)' }}
    >
      {!profile.banner_image && <div aria-hidden className="pf-hatch absolute inset-0" />}
      <div aria-hidden className="absolute inset-0" style={{ backgroundImage: GRID_LINES }} />
      {profile.banner_image && (
        <SafeBannerImg
          src={profile.banner_image}
          frame={profile.banner_frame}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {profile.rank !== null && (
        <span
          aria-hidden
          className="absolute -bottom-3 right-4 select-none text-[64px] leading-none [font-family:var(--font-pixel)]"
          style={{ color: 'rgb(var(--pf-ink-rgb) / 0.1)' }}
        >
          #{profile.rank}
        </span>
      )}
      {isYou && (
        <button
          type="button"
          onClick={onEdit}
          className="pf-frame absolute right-3 top-3 z-10 flex h-9 items-center gap-1.5 px-3 font-data text-[10px] uppercase tracking-[0.18em] transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-[color:var(--pf-ink)] sm:after:content-none"
          style={{ background: 'var(--pf-paper)', color: 'var(--pf-ink-2)' }}
        >
          <Stroke d={PATH_EDIT} size={10} />
          EDIT BANNER
        </button>
      )}
    </div>
  )
}
