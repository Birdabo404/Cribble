# Interactive tilt inventory

## Informational glass cards (crisp-content contract)

`GlassTilt` delegates to every `.liquid-glass` card. The shared CSS contract now
projects only `::before` (sheen) and `::after` (glass shell); the host and all
dashboard, token dashboard, profile/settings, modal, navigation, and toast
content remain untransformed.

## Bespoke informational cards (follow-up candidates)

- `leaderboard/PlayerCard.tsx`
- `leaderboard/TokenPlayerCard.tsx`
- `leaderboard/ToolCard.tsx`
- `landing/IdentitySection.tsx`
- `app/(app)/bag/page.tsx`

These own separate full-card pointer transforms and are intentionally not
silently coupled to the global glass selector. They should adopt a component-
specific shell/content split before claiming crisp readable text during motion.

## Decorative/physical transforms (excluded)

- `leaderboard/LeaderboardSponsorFlip.tsx`: explicit two-face physical flip.
- `cosmetics/PlateLayer.tsx`: decorative card flip and particle tumbles.
- `landing/ArenaSection.tsx`, `landing/CockpitSection.tsx`: scroll-stage scenery.
- `stylizedEarthRenderer.ts`: geometry orientation, not DOM text.
