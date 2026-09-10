'use client'

// Query-flag notice — the checkout / portal bounce strip, in the
// compartment chrome: a square, tone-bordered compartment on the tone's
// wash, the title in mono LABEL, the body in copy, then the two controls:
// RE-CHECK (checkout-success only; spins while the sync runs) and the
// dismiss cross. Both are tap-floor tall below md. Copy and tones come
// from useShopCosmetics (noticeMeta, NOTICE_TONES) unchanged. No entrance
// animation here — the page owns the reveals.

import { IconClose, IconRefresh } from '@/components/leaderboard/icons'
import { COPY, FOCUS, LABEL, MUTE, TAP } from './shopChrome'
import { NOTICE_TONES, noticeMeta, type ShopNotice } from './useShopCosmetics'

export interface ShopNoticeBannerProps {
  notice: ShopNotice
  refreshing: boolean
  onRefresh: () => void
  onDismiss: () => void
}

export function ShopNoticeBanner({ notice, refreshing, onRefresh, onDismiss }: ShopNoticeBannerProps) {
  const meta = noticeMeta(notice)
  const tone = NOTICE_TONES[meta.tone]

  return (
    <div
      role="status"
      className="shpn-notice flex flex-wrap items-center gap-x-4 gap-y-2 border px-[var(--shop-pad)] py-3"
      style={{ borderColor: tone.border, background: tone.wash }}
    >
      <span className={`shpn-title ${LABEL}`} style={{ color: tone.fg }}>
        {meta.title}
      </span>
      <span className={`shpn-body min-w-0 flex-1 basis-52 ${COPY} ${MUTE}`}>{meta.body}</span>
      {notice === 'checkout-success' && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className={`shpn-recheck inline-flex ${TAP} items-center gap-x-2 px-3 md:min-h-0 md:py-1 ${LABEL} ${MUTE} ${FOCUS} disabled:cursor-wait`}
        >
          <IconRefresh size={11} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Checking' : 'Re-check'}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        className={`shpn-dismiss inline-flex h-[var(--shop-tap)] w-[var(--shop-tap)] shrink-0 items-center justify-center md:h-auto md:w-auto md:p-1 ${MUTE} ${FOCUS}`}
      >
        <IconClose size={12} />
      </button>

      <style jsx global>{`
        .shpn-recheck,
        .shpn-dismiss {
          transition: color 160ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        @media (hover: hover) and (pointer: fine) {
          .shpn-recheck:hover:not(:disabled),
          .shpn-dismiss:hover {
            color: var(--shop-ink);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .shpn-recheck,
          .shpn-dismiss {
            transition: none;
          }
        }
        html[data-motion='reduced'] .shpn-recheck,
        html[data-motion='reduced'] .shpn-dismiss {
          transition: none;
        }
      `}</style>
    </div>
  )
}
