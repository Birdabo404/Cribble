'use client'

// Billing — plan card, the Premium perk list, and cosmetics link-outs,
// hydrated from /api/user/cosmetics exactly like PremiumSettingsModal.
// Paid accounts manage their subscription through /api/portal (a plain
// browser navigation — the route resolves the Polar customer portal and
// redirects); free accounts upgrade through /shop, where the Premium
// console runs checkout via /api/checkout?type=pro_monthly|pro_yearly.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PREMIUM_PERKS, formatPremiumSince } from '@/components/premium/premium'
import { getPlate } from '@/lib/cosmetics/plates'
import { PRO_TERMS } from '@/lib/planTerms'
import { SettingsButton, SettingsRow, SettingsSection, SkeletonRow } from '@/components/settings'

interface CosmeticsState {
  tier: string
  isPro: boolean
  complimentary: boolean
  ownedPlateIds: string[]
  equippedPlate: string | null
  premiumSince: string | null
}

// Anchor twins of SettingsButton's solid/ghost variants — plan actions
// are navigations (portal redirect, shop), not in-page mutations.
const solidLinkCls =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-[color:var(--st-accent)] px-3 text-[13px] font-medium leading-none text-[color:var(--st-accent-contrast)] transition-colors duration-150 hover:opacity-90 md:h-8'
const ghostLinkCls =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-[13px] font-medium leading-none text-[color:var(--st-text-muted)] transition-colors duration-150 hover:bg-[color:var(--st-panel-hover)] hover:text-[color:var(--st-text)] md:h-8'

const CHECK_ICON = (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m3.25 8.5 3 3 6.5-7" />
  </svg>
)

function planName(state: CosmeticsState): string {
  if (state.isPro) return 'Cribble Premium'
  if (state.tier.trim().toUpperCase() === 'TEAM') return 'Cribble Team'
  return 'Free'
}

/** Paid = anything with a live subscription behind it (Premium tiers or
 *  Team) — these accounts get the portal link instead of the upsell. */
function isPaid(state: CosmeticsState): boolean {
  return state.isPro || state.tier.trim().toUpperCase() === 'TEAM'
}

export function BillingSection() {
  const [state, setState] = useState<CosmeticsState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState(null)
    setLoadFailed(false)

    fetch('/api/user/cosmetics', { cache: 'no-store', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.success) {
          setState({
            tier: typeof data.tier === 'string' ? data.tier : 'FREE',
            isPro: data.isPro === true,
            complimentary: data.complimentary === true,
            ownedPlateIds: Array.isArray(data.ownedPlateIds)
              ? data.ownedPlateIds.map(String)
              : [],
            equippedPlate: typeof data.equippedPlate === 'string' ? data.equippedPlate : null,
            premiumSince: typeof data.premiumSince === 'string' ? data.premiumSince : null
          })
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  if (loadFailed) {
    return (
      <SettingsSection title="Plan">
        <div className="flex items-center justify-between gap-6 px-4 py-3.5 sm:px-5 sm:py-4">
          <p className="text-[13px] leading-5 text-[color:var(--st-text-muted)]">
            Couldn&apos;t load your billing details.
          </p>
          <SettingsButton variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </SettingsButton>
        </div>
      </SettingsSection>
    )
  }

  if (state === null) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Plan">
          <SkeletonRow />
        </SettingsSection>
        <SettingsSection title="Cosmetics">
          <SkeletonRow />
          <SkeletonRow />
        </SettingsSection>
      </div>
    )
  }

  const paid = isPaid(state)
  const equippedPlateName = state.equippedPlate
    ? (getPlate(state.equippedPlate)?.name ?? state.equippedPlate)
    : null

  return (
    <div className="space-y-8">
      <SettingsSection title="Plan">
        <SettingsRow
          stack
          label={planName(state)}
          description={
            state.complimentary ? (
              'House complimentary — never billed.'
            ) : paid ? (
              <>
                Member since{' '}
                <span className="text-[12px] [font-family:var(--font-data)]">
                  {formatPremiumSince(state.premiumSince)}
                </span>
              </>
            ) : (
              'Core tracking, the leaderboard, and your public profile.'
            )
          }
        >
          {state.complimentary ? null : paid ? (
            // Plain <a>: /api/portal answers with a redirect to Polar's
            // hosted customer portal, same navigation the modal used.
            <a href="/api/portal" className={solidLinkCls}>
              Manage subscription
            </a>
          ) : (
            <Link href="/shop" className={solidLinkCls}>
              Upgrade to Premium
            </Link>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={state.isPro ? "What's included" : 'What Premium unlocks'}
        description={
          state.isPro
            ? undefined
            : `The full kit, from ${PRO_TERMS.monthly.price} a month. Cancel anytime.`
        }
      >
        {PREMIUM_PERKS.map((perk) => (
          <div key={perk.label} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="shrink-0 text-[color:var(--st-text-muted)]">{CHECK_ICON}</span>
            <span className="text-[14px] leading-5 text-[color:var(--st-text)]">{perk.label}</span>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection title="Cosmetics">
        <SettingsRow
          label="Equipped plate"
          description="Shown behind your name on the leaderboard."
        >
          <span className="text-[12px] text-[color:var(--st-text-muted)] [font-family:var(--font-data)]">
            {equippedPlateName ?? 'None'}
          </span>
        </SettingsRow>
        <SettingsRow
          label="Leaderboard plates"
          description="Plates and the rest of the kit live in the shop."
          stack
        >
          <Link href="/shop" className={ghostLinkCls}>
            Browse leaderboard plates
            <span aria-hidden>→</span>
          </Link>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}
