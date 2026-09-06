'use client'

// The Bag — THE MANIFEST. A blueprint-grid inventory sheet that answers
// "do I have X?" in two seconds: counts first, then index rail · register
// · spec sheet, collapsing to two tracks on tablet and to one column with a
// sticky loadout strip + spec drawer on phones. Plates register as ledger
// rows, badges as inventory slots; only the item on the sheet is alive.
// Composition only — rules live in bagModel.ts, network in useBagData.ts.
//
// No backend changes — everything runs on existing APIs. A signed-out or
// failed fetch degrades to neutral (browsable catalog, nothing owned, no
// equip offered, placeholder identity), same philosophy as the shop.

import { useEffect, useMemo, useRef, useState } from 'react'
import { BadgeRegister } from '@/components/bag/BadgeRegister'
import { BadgeSpecSheet } from '@/components/bag/BadgeSpecSheet'
import { CompartmentIndex } from '@/components/bag/CompartmentIndex'
import { LoadoutStrip } from '@/components/bag/LoadoutStrip'
import { ManifestHeader } from '@/components/bag/ManifestHeader'
import { PlateRegister } from '@/components/bag/PlateRegister'
import { PlateSpecSheet } from '@/components/bag/PlateSpecSheet'
import { SpecDrawer } from '@/components/bag/SpecDrawer'
import {
  NEUTRAL_BADGES,
  badgeSerial,
  countUnlocked,
  countUsable,
  defaultBadgeSelection,
  filterBadges,
  filterPlates,
  plateSerial,
  revStamp,
  statusFor,
  type BadgeFilter,
  type BagTab,
  type OwnFilter,
  type RarityFilter
} from '@/components/bag/bagModel'
import { MICRO, MUTE, PAPER_BG } from '@/components/bag/manifestChrome'
import { useBagData } from '@/components/bag/useBagData'
import { LG_MIN, MD_MIN, useMinWidth } from '@/components/bag/useMinWidth'
import { PLATES, getPlate } from '@/lib/cosmetics/plates'

// "BAG" in ANSI Shadow block characters — survives only as the footer stamp.
const ASCII_BAG = String.raw`██████╗  █████╗  ██████╗
██╔══██╗██╔══██╗██╔════╝
██████╔╝███████║██║  ███╗
██╔══██╗██╔══██║██║   ██║
██████╔╝██║  ██║╚██████╔╝
╚═════╝ ╚═╝  ╚═╝ ╚═════╝`

/** Every track of the blueprint grid: paper, with the gutter the spec
 * sheet's and rows' registration crosses need (they sit 4px outside). */
const CELL = `${PAPER_BG} min-w-0 p-[var(--bag-pad)]`

/** Sticky spec sheet: clears the fixed top bar plus its 1px border (md+
 * renders under the 0.9 page zoom, which scales sticky `top`, hence the
 * division) and docks a gutter below the viewport edge in rail mode,
 * where there is no top bar. */
const SPEC_STICKY =
  'md:sticky md:top-[calc((var(--nav-topbar-h)_+_1px)/0.9_+_var(--bag-pad))] md:[html[data-nav-pos=left]_&]:top-[var(--bag-pad)]'

const HINT: Record<BagTab, string> = {
  plates: '↑↓ SELECT · ⏎ EQUIP · ⇥ INDEX',
  badges: '←↑↓→ SELECT · ⏎ DETAIL'
}

export default function BagPage() {
  const {
    cosmetics,
    identity,
    equippedPlate,
    equipping,
    syncState,
    usableIds,
    defaultPlateId,
    achievements,
    achievementsState,
    loadAchievements,
    equip,
    retry
  } = useBagData()

  const [tab, setTab] = useState<BagTab>('plates')
  const [selectedPlateId, setSelectedPlateId] = useState<string>(PLATES[0].id)
  const [query, setQuery] = useState('')
  const [ownFilter, setOwnFilter] = useState<OwnFilter>('all')
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all')
  const [badgeQuery, setBadgeQuery] = useState('')
  const [badgeFilter, setBadgeFilter] = useState<BadgeFilter>('all')
  const [selectedBadgeId, setSelectedBadgeId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Once the pilot has picked a row, the sheet's default never overrides it.
  const userPicked = useRef(false)

  const isMd = useMinWidth(MD_MIN)
  const isLg = useMinWidth(LG_MIN)

  // Adopt the data-derived default (equipped → first usable → catalog
  // front) when it lands, unless the pilot already chose; a RETRY that
  // re-derives it while nothing was picked adopts again.
  useEffect(() => {
    if (defaultPlateId !== null && !userPicked.current) setSelectedPlateId(defaultPlateId)
  }, [defaultPlateId])

  useEffect(() => {
    if (tab === 'badges') loadAchievements()
  }, [tab, loadAchievements])

  // The drawer belongs to the single-column layout: crossing into md+ (the
  // sheet gets its own track and the strip, its opener, goes away) leaves
  // it stale, so it closes.
  useEffect(() => {
    if (isMd) setDrawerOpen(false)
  }, [isMd])

  // Below md the sheet is off-screen: it lives in the drawer, opened from
  // the strip or from Enter on a row. From md the sheet is in track 3.
  const openDrawer = () => {
    if (!isMd) setDrawerOpen(true)
  }

  const loading = cosmetics === null
  const visiblePlates = useMemo(
    () => filterPlates({ query, ownFilter, rarityFilter, usableIds }),
    [query, ownFilter, rarityFilter, usableIds]
  )
  const filteredBadges = useMemo(
    () => (achievements ? filterBadges(achievements, { query: badgeQuery, filter: badgeFilter }) : []),
    [achievements, badgeQuery, badgeFilter]
  )
  const selectedPlate = getPlate(selectedPlateId) ?? PLATES[0]
  const selectedStatus = statusFor(selectedPlate.id, equippedPlate, usableIds)
  const selectedBadge = useMemo(
    () => defaultBadgeSelection(achievements ?? [], selectedBadgeId),
    [achievements, selectedBadgeId]
  )
  const usableCount = countUsable(usableIds)
  const unlockedCount = achievements ? countUnlocked(achievements) : null
  const badgeTotal = achievements?.length ?? NEUTRAL_BADGES.length

  const selectPlate = (id: string) => {
    userPicked.current = true
    setSelectedPlateId(id)
  }

  const clearFilters = () => {
    switch (tab) {
      case 'plates':
        setQuery('')
        setOwnFilter('all')
        setRarityFilter('all')
        return
      case 'badges':
        setBadgeQuery('')
        setBadgeFilter('all')
        return
      default: {
        const exhaustive: never = tab
        return exhaustive
      }
    }
  }

  // Enter / Space on a row. Below md the sheet is off-screen, so a locked
  // plate (or any badge) opens the drawer instead; from md it is already
  // beside the register and Enter only equips.
  const activatePlate = (id: string) => {
    const status = statusFor(id, equippedPlate, usableIds)
    switch (status) {
      case 'usable':
        void equip(id)
        return
      case 'equipped':
        void equip(null)
        return
      case 'locked':
        openDrawer()
        return
      default: {
        const exhaustive: never = status
        return exhaustive
      }
    }
  }
  const activateBadge = () => {
    openDrawer()
  }

  const indexProps = {
    tab,
    onTab: setTab,
    plateCount: { usable: usableCount, total: PLATES.length },
    badgeCount: { unlocked: unlockedCount, total: badgeTotal },
    query: tab === 'plates' ? query : badgeQuery,
    onQuery: tab === 'plates' ? setQuery : setBadgeQuery,
    ownFilter,
    onOwnFilter: setOwnFilter,
    rarityFilter,
    onRarityFilter: setRarityFilter,
    badgeFilter,
    onBadgeFilter: setBadgeFilter,
    onClear: clearFilters
  }

  const register =
    tab === 'plates' ? (
      <PlateRegister
        plates={visiblePlates}
        selectedId={selectedPlate.id}
        equippedPlate={equippedPlate}
        usableIds={usableIds}
        loading={loading}
        unknown={syncState === 'error'}
        compact={!isMd}
        onSelect={selectPlate}
        onActivate={activatePlate}
        onClearFilters={clearFilters}
      />
    ) : (
      <BadgeRegister
        rows={filteredBadges}
        selectedId={selectedBadge?.id ?? null}
        loading={achievements === null || achievementsState === 'loading'}
        onSelect={setSelectedBadgeId}
        onActivate={activateBadge}
        onClearFilters={clearFilters}
      />
    )

  const sheet = (variant: 'panel' | 'drawer') =>
    tab === 'plates' ? (
      <PlateSpecSheet
        plate={selectedPlate}
        status={selectedStatus}
        identity={identity}
        loading={loading}
        syncState={syncState}
        equipping={equipping}
        onEquip={equip}
        variant={variant}
      />
    ) : selectedBadge ? (
      <BadgeSpecSheet row={selectedBadge} variant={variant} />
    ) : null

  const drawerTitle =
    tab === 'plates'
      ? plateSerial(selectedPlate.id)
      : selectedBadge
        ? badgeSerial(selectedBadge.id)
        : '[ SPEC SHEET ]'

  return (
    <div className="bag-manifest page-zoom-out relative mx-auto max-w-6xl px-4 pt-6 sm:px-6 pb-[max(4rem,env(safe-area-inset-bottom))]">
      {/* the sheet itself: one paper frame on the canvas, scanlines (dark) /
          grain (light) over the whole of it, header and footer included */}
      <div className={`bag-scanlines bag-grain relative ${PAPER_BG}`}>
        <ManifestHeader
          identity={identity}
          usableCount={usableCount}
          plateTotal={PLATES.length}
          unlockedCount={unlockedCount}
          badgeTotal={badgeTotal}
          syncState={syncState}
          achievementsState={achievementsState}
          onRetry={retry}
        />

        <CompartmentIndex {...indexProps} layout="strip" className="lg:hidden mt-4" />

        {/* the strip and its drawer belong to the single column; from md
            the sheet has its own track, so neither is mounted there */}
        {!isMd && (
          <LoadoutStrip
            tab={tab}
            plate={selectedPlate}
            plateStatus={selectedStatus}
            badge={selectedBadge}
            loading={tab === 'badges' ? achievements === null : loading}
            syncState={syncState}
            equipping={equipping}
            onEquip={equip}
            onOpen={openDrawer}
            className="md:hidden mt-3"
          />
        )}

        <div className="mt-4 grid gap-px bg-[color:var(--bag-line)] md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[200px_minmax(0,1fr)_340px] xl:grid-cols-[220px_minmax(0,1fr)_380px]">
          {/* track 1 — the index rail, lg+ only */}
          <div className={`hidden lg:block ${CELL}`}>
            <CompartmentIndex {...indexProps} layout="rail" />
          </div>

          {/* track 2 — the register + desktop key hints */}
          <section
            id={`bag-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`bag-${isLg ? 'rail' : 'strip'}-tab-${tab}`}
            className={CELL}
          >
            {register}
            <p aria-hidden className={`mt-3 hidden lg:flex ${MICRO} ${MUTE}`}>
              {HINT[tab]}
            </p>
          </section>

          {/* track 3 — the sticky spec sheet, md+ only. The cell is always
              painted (it stays so while the badges are in flight and there
              is no row to show); the sheet inside mounts only from md, so
              below md the one live PlateLayer set is the drawer's */}
          <div className={`hidden md:block ${CELL}`}>
            <div className={SPEC_STICKY}>{isMd ? sheet('panel') : null}</div>
          </div>
        </div>

        <footer
          className={`mt-6 flex items-center justify-between gap-4 border-t border-[color:var(--bag-line)] pt-3 ${MICRO} ${MUTE}`}
        >
          <span className="flex items-center gap-3">
            <pre aria-hidden className="whitespace-pre font-mono text-[5px] leading-[0.9] tracking-normal">
              {ASCII_BAG}
            </pre>
            <span>CRIBBLE · {new Date().getFullYear()}</span>
          </span>
          <span className="flex items-center gap-3 whitespace-nowrap text-right">
            <span className="hidden sm:inline">{'// pack it, fly it'}</span>
            <span>{revStamp(new Date())}</span>
          </span>
        </footer>
      </div>

      <SpecDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={drawerTitle}>
        {sheet('drawer')}
      </SpecDrawer>
    </div>
  )
}
