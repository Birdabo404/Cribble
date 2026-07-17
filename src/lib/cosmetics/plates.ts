// Leaderboard Plate catalog — pure data + pure functions. No React, no
// server-only imports: this module is consumed by client components
// (PlateLayer, the shop grid) and by API routes (ownership validation,
// checkout product mapping via plate id) alike.
//
// A plate is a Discord-style nameplate: a horizontal strip rendered BEHIND a
// player's avatar + name on leaderboard rows, podium cards, the PlayerCard
// modal and the profile hero. The left side fades toward the panel surface so
// overlaid text stays readable; the visual motif concentrates on the right.
//
// Launch plates are procedural (`kind: 'css'`): each `base` is a full painted
// scene — gradient skies plus inline-SVG scenery (silhouettes, engravings,
// props) as data-URI layers — and `fx` names the PlateLayer animation scene
// that lives on top. Everything ships as text; no binary assets. Final art
// later drops into /public/plates/ as animated WebP strips (~1000×120, plus
// a static frame) using `kind: 'image'`.
//
// Colors are deliberately theme-independent literals (same precedent as
// `Medal.plate` in components/leaderboard/types.ts): a plate is a product and
// must look identical for every buyer in both themes. Only the readability
// scrim (applied by PlateLayer) adapts to the theme.

export type PlateRarity = 'common' | 'rare' | 'epic' | 'legendary'

/** Chip styling per rarity — mirrors the achievement rarity palette
 * (`--r-*` in globals.css), so plate chips match badge chips in both themes. */
export const PLATE_RARITY_META: Record<PlateRarity, { label: string; color: string }> = {
  common: { label: 'COMMON', color: 'rgb(var(--r-common))' },
  rare: { label: 'RARE', color: 'rgb(var(--r-rare))' },
  epic: { label: 'EPIC', color: 'rgb(var(--r-epic))' },
  legendary: { label: 'LEGENDARY', color: 'rgb(var(--r-legendary))' }
}

/** Animated-scene presets implemented by PlateFx. Adding a preset means
 * adding a case to its exhaustive switch — the compiler enforces it. */
export type PlateFx =
  | 'synthwave-grid'
  | 'deep-space'
  | 'terminal-rain'
  | 'koi-pond'
  | 'cherry-blossom'
  | 'keyboard-cat'
  | 'champions-gold'
  | 'ignition'
  | 'pro-circuit'
  | 'aurora-drift'
  | 'midnight-ops'
  | 'founder'
  | 'beta-tester'

export interface PlateCssRender {
  kind: 'css'
  /** CSS background layers, top layer first (multi-background paint order).
   * Painted as one `background` value by PlateLayer — pure data, so the shop
   * can also use it for cheap static thumbnails. Layers may be gradients or
   * inline-SVG data URIs with position/size in background shorthand. */
  base: string[]
  /** Animated scene rendered on top of `base`. */
  fx: PlateFx
  /** Dominant hue as an `R G B` triplet, for glows/chips around the plate. */
  accent: string
}

export interface PlateImageRender {
  kind: 'image'
  /** Animated WebP strip, ~1000×120, served from /public/plates/. */
  animatedSrc: string
  /** Static frame — error fallback and prefers-reduced-motion source. */
  staticSrc: string
}

export type PlateRender = PlateCssRender | PlateImageRender

export interface PlateDef {
  id: string
  name: string
  tagline: string
  rarity: PlateRarity
  /** One-time USD price. null = not purchasable (pro / champion / beta
   * exclusives). Retiring a sold plate is the reverse edit: set this back
   * to null and the checkout route refuses it from then on. */
  priceUsd: number | null
  /** Usable while a Cribble Pro subscription is active (`pro_grant`). */
  proExclusive?: boolean
  /** Trophy plate: minted into user_cosmetics when the APEX achievement
   * (rank #1) unlocks. Never sold — the checkout route refuses it. */
  championExclusive?: boolean
  /** Beta-tester gift: minted into user_cosmetics when an invite-code
   * signup finishes the welcome page. Never sold. */
  betaExclusive?: boolean
  /** Limited drop — retired when the season ends. */
  seasonal?: { label: string }
  render: PlateRender
}

/** Encodes an SVG document as a CSS `url()` image layer. Spaces and commas
 * stay raw — valid inside a quoted data URI — to keep the payload compact. */
const svg = (markup: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(markup)
    .replace(/%20/g, ' ')
    .replace(/%2C/g, ',')}")`

// ---------------------------------------------------------------------------
// Scenery — inline SVG props referenced by the catalog below. Fixed-px
// placement (via background shorthand) keeps motifs legible from the ~58px
// preview strip and ~68px leaderboard row up to the 112px podium/profile-card
// banner; height-proportional placement (auto ${'100%'}) is used where the
// art should scale with the strip.
// ---------------------------------------------------------------------------

/** Twin mountain ranges on the synthwave horizon (stretched full-width). */
const SYNTHWAVE_RIDGE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 60' preserveAspectRatio='none'>" +
    "<path d='M0 60V34l30-16 26 12 34-22 30 18 24-10 36 22 28-16 30 12 26-20 40 24 30-14 36 18 30-12V60Z' fill='#2b1052'/>" +
    "<path d='M0 60V44l24-10 30 14 28-18 34 20 22-8 38 16 26-12 34 14 30-18 34 20 30-10 40 14V60Z' fill='#180734'/>" +
    '</svg>'
)

/** Sparse high-altitude stars for the synthwave sky. */
const SYNTHWAVE_STARS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 46'>" +
    "<g fill='#ffd9ec'><circle cx='14' cy='10' r='0.9' fill-opacity='.5'/><circle cx='48' cy='6' r='0.7' fill-opacity='.35'/><circle cx='82' cy='14' r='1' fill-opacity='.45'/><circle cx='30' cy='26' r='0.6' fill-opacity='.3'/><circle cx='100' cy='30' r='0.8' fill-opacity='.4'/></g>" +
    '</svg>'
)

/** Far starfield tile for Deep Space (a third, static parallax depth). */
const SPACE_STARS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 80'>" +
    "<g fill='#e2e8ff'><circle cx='12' cy='18' r='1' fill-opacity='.5'/><circle cx='44' cy='8' r='0.7' fill-opacity='.35'/><circle cx='76' cy='30' r='1.1' fill-opacity='.55'/><circle cx='108' cy='12' r='0.8' fill-opacity='.3'/><circle cx='128' cy='46' r='1' fill-opacity='.45'/><circle cx='22' cy='58' r='0.7' fill-opacity='.3'/><circle cx='60' cy='66' r='1' fill-opacity='.4'/><circle cx='96' cy='54' r='0.7' fill-opacity='.3'/><circle cx='136' cy='70' r='0.6' fill-opacity='.25'/></g>" +
    '</svg>'
)

/** Lily pads (thin natural slits) + a lotus, floating near the koi. */
const KOI_PADS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 230 54'>" +
    "<g stroke='#94f0dc' stroke-opacity='.22'>" +
    "<path d='M178 20L194.8 17.6A17 17 0 1 0 194.8 22.4Z' fill='#0f463e'/>" +
    "<path d='M126 40L136.9 38.5A11 11 0 1 0 136.9 41.5Z' fill='#0d3c34' transform='rotate(40 126 40)'/>" +
    "<path d='M212 44L219.9 42.9A8 8 0 1 0 219.9 45.1Z' fill='#0f463e' transform='rotate(-15 212 44)'/>" +
    '</g>' +
    "<g fill='#ff9ac2'><ellipse cx='168' cy='13' rx='2.6' ry='4.6' transform='rotate(-22 168 13)' fill-opacity='.9'/><ellipse cx='172' cy='11' rx='2.6' ry='4.8'/><ellipse cx='176' cy='13' rx='2.6' ry='4.6' transform='rotate(22 176 13)' fill-opacity='.9'/></g>" +
    "<circle cx='172' cy='15' r='1.3' fill='#ffd644'/>" +
    '</svg>'
)

/** Cherry branch reaching in from the top-right corner, in bloom. */
const BLOSSOM_BRANCH = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 280 97'>" +
    "<g stroke='#33141f' fill='none' stroke-linecap='round'>" +
    "<path d='M280 10C236 22 208 20 178 40C160 52 148 52 132 60' stroke-width='7'/>" +
    "<path d='M216 26C206 14 196 10 184 8' stroke-width='4'/>" +
    "<path d='M178 40C172 30 162 26 150 26' stroke-width='3'/>" +
    "<path d='M148 53C140 46 130 44 120 46' stroke-width='2.5'/>" +
    '</g>' +
    "<g><circle cx='132' cy='62' r='6' fill='#f06ea5'/><circle cx='125' cy='56' r='4.5' fill='#ff9ac2'/><circle cx='139' cy='55' r='4' fill='#ffc4dc'/>" +
    "<circle cx='184' cy='8' r='5' fill='#ff9ac2'/><circle cx='176' cy='12' r='4' fill='#f06ea5'/><circle cx='191' cy='14' r='3.5' fill='#ffc4dc'/>" +
    "<circle cx='150' cy='26' r='4.5' fill='#ffc4dc'/><circle cx='143' cy='31' r='3.5' fill='#ff9ac2'/>" +
    "<circle cx='120' cy='46' r='4' fill='#ff9ac2'/><circle cx='113' cy='50' r='3' fill='#ffc4dc'/>" +
    "<circle cx='240' cy='15' r='4' fill='#ffc4dc'/><circle cx='249' cy='20' r='3' fill='#ff9ac2'/><circle cx='206' cy='31' r='3' fill='#f06ea5'/>" +
    "<circle cx='163' cy='45' r='2' fill='#ffc4dc'/><circle cx='222' cy='22' r='1.8' fill='#ff9ac2'/></g>" +
    '</svg>'
)

/** Two rows of backlit keycaps along the bottom edge. */
const CAT_KEYBOARD = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 32'>" +
    "<g fill='#ffffff' fill-opacity='.05' stroke='#ffb05c' stroke-opacity='.4'>" +
    "<rect x='1' y='2' width='18' height='12' rx='3'/><rect x='22' y='2' width='18' height='12' rx='3'/><rect x='43' y='2' width='18' height='12' rx='3'/><rect x='64' y='2' width='18' height='12' rx='3'/><rect x='85' y='2' width='18' height='12' rx='3'/><rect x='106' y='2' width='18' height='12' rx='3'/><rect x='127' y='2' width='18' height='12' rx='3'/><rect x='148' y='2' width='18' height='12' rx='3'/><rect x='169' y='2' width='18' height='12' rx='3'/>" +
    "<rect x='11' y='17' width='18' height='12' rx='3'/><rect x='32' y='17' width='18' height='12' rx='3'/><rect x='53' y='17' width='18' height='12' rx='3'/><rect x='74' y='17' width='18' height='12' rx='3'/><rect x='95' y='17' width='18' height='12' rx='3'/><rect x='116' y='17' width='18' height='12' rx='3'/><rect x='137' y='17' width='18' height='12' rx='3'/><rect x='158' y='17' width='18' height='12' rx='3'/><rect x='179' y='17' width='18' height='12' rx='3'/>" +
    '</g>' +
    '</svg>'
)

/** The champion's trophy: laurel wreath wrapping a chunky pixel "1"
 * (matching the site's pixel score font), cast with a bronze drop-shadow
 * echo so the numeral reads engraved. The crown that sits on the "1" is
 * drawn by the FX layer — it bobs. */
const GOLD_TROPHY = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 90'>" +
    "<g stroke='#ffd644' stroke-opacity='.4' stroke-width='2' fill='none'>" +
    "<path d='M36 82C18 66 14 44 26 22'/><path d='M84 82C102 66 106 44 94 22'/>" +
    '</g>' +
    "<g fill='#ffd644' fill-opacity='.5'>" +
    "<ellipse cx='32' cy='72' rx='7' ry='2.6' transform='rotate(-38 32 72)'/><ellipse cx='24' cy='58' rx='7' ry='2.6' transform='rotate(-62 24 58)'/><ellipse cx='20' cy='44' rx='7' ry='2.6' transform='rotate(-84 20 44)'/><ellipse cx='22' cy='30' rx='7' ry='2.6' transform='rotate(-106 22 30)'/><ellipse cx='28' cy='17' rx='7' ry='2.6' transform='rotate(-126 28 17)'/>" +
    "<ellipse cx='88' cy='72' rx='7' ry='2.6' transform='rotate(38 88 72)'/><ellipse cx='96' cy='58' rx='7' ry='2.6' transform='rotate(62 96 58)'/><ellipse cx='100' cy='44' rx='7' ry='2.6' transform='rotate(84 100 44)'/><ellipse cx='98' cy='30' rx='7' ry='2.6' transform='rotate(106 98 30)'/><ellipse cx='92' cy='17' rx='7' ry='2.6' transform='rotate(126 92 17)'/>" +
    '</g>' +
    // pixel "1": bronze echo behind, gold face, gloss cap on the stem
    "<g fill='#6b4e0c' fill-opacity='.9' transform='translate(2.5 3)'>" +
    "<rect x='44' y='26' width='12' height='10'/><rect x='52' y='18' width='14' height='44'/><rect x='42' y='62' width='34' height='10'/>" +
    '</g>' +
    "<g fill='#ffd644'>" +
    "<rect x='44' y='26' width='12' height='10'/><rect x='52' y='18' width='14' height='44'/><rect x='42' y='62' width='34' height='10'/>" +
    '</g>' +
    "<rect x='52' y='18' width='14' height='5' fill='#fff0a0'/>" +
    "<rect x='42' y='62' width='34' height='3' fill='#fff0a0' fill-opacity='.7'/>" +
    '</svg>'
)

/** Checkered flag strip fading in toward the right edge. */
const IGNITION_CHECKER = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 168 16'>" +
    "<g fill='#ffffff'>" +
    "<rect x='48' y='0' width='8' height='8' fill-opacity='.05'/><rect x='56' y='8' width='8' height='8' fill-opacity='.06'/><rect x='64' y='0' width='8' height='8' fill-opacity='.08'/><rect x='72' y='8' width='8' height='8' fill-opacity='.09'/><rect x='80' y='0' width='8' height='8' fill-opacity='.11'/><rect x='88' y='8' width='8' height='8' fill-opacity='.12'/><rect x='96' y='0' width='8' height='8' fill-opacity='.14'/><rect x='104' y='8' width='8' height='8' fill-opacity='.15'/><rect x='112' y='0' width='8' height='8' fill-opacity='.17'/><rect x='120' y='8' width='8' height='8' fill-opacity='.18'/><rect x='128' y='0' width='8' height='8' fill-opacity='.2'/><rect x='136' y='8' width='8' height='8' fill-opacity='.21'/><rect x='144' y='0' width='8' height='8' fill-opacity='.23'/><rect x='152' y='8' width='8' height='8' fill-opacity='.24'/><rect x='160' y='0' width='8' height='8' fill-opacity='.26'/><rect x='160' y='8' width='8' height='8' fill-opacity='.13'/><rect x='144' y='8' width='8' height='8' fill-opacity='.11'/><rect x='128' y='8' width='8' height='8' fill-opacity='.1'/>" +
    '</g>' +
    '</svg>'
)

/** Etched PCB: traces with 45° jogs, pads and vias. The IC package itself is
 * drawn by the pro-circuit FX layer (it pulses), so the base stays chipless. */
const CIRCUIT_BOARD = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 100' preserveAspectRatio='xMaxYMid meet'>" +
    "<g stroke='#22d3ee' stroke-opacity='.28' stroke-width='1.5' fill='none'>" +
    "<path d='M300 16H228l-14 14H150'/><path d='M300 86h-64l-16-14h-42'/><path d='M188 30v42'/>" +
    '</g>' +
    "<g fill='#22d3ee'><circle cx='150' cy='30' r='3' fill-opacity='.5'/><circle cx='178' cy='72' r='3' fill-opacity='.45'/><circle cx='282' cy='8' r='1.6' fill-opacity='.3'/><circle cx='258' cy='94' r='1.6' fill-opacity='.3'/><circle cx='214' cy='10' r='1.6' fill-opacity='.25'/><circle cx='240' cy='92' r='1.6' fill-opacity='.25'/></g>" +
    '</svg>'
)

/** Dim starfield tile behind the aurora. */
const AURORA_STARS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 60'>" +
    "<g fill='#e2e8ff'><circle cx='16' cy='12' r='0.9' fill-opacity='.4'/><circle cx='52' cy='8' r='0.6' fill-opacity='.28'/><circle cx='88' cy='18' r='1' fill-opacity='.38'/><circle cx='34' cy='34' r='0.6' fill-opacity='.24'/><circle cx='108' cy='40' r='0.8' fill-opacity='.3'/><circle cx='70' cy='48' r='0.7' fill-opacity='.26'/></g>" +
    '</svg>'
)

/** Arctic ridgeline under the aurora (stretched full-width), snow-lit. */
const AURORA_RIDGE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 44' preserveAspectRatio='none'>" +
    "<path d='M0 44V30l34-12 30 9 38-16 34 12 26-8 42 14 30-10 40 13 34-9 44 12 24-7 24 8V44Z' fill='#16224a'/>" +
    "<path d='M0 44V37l28-8 34 10 30-12 38 12 24-6 40 10 32-8 40 10 30-6 44 9 30-5V44Z' fill='#0a1230'/>" +
    '</svg>'
)

/** Tactical chart: topographic contours + survey crosses. */
const OPS_TOPO = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 260 100' preserveAspectRatio='xMaxYMid meet'>" +
    "<g stroke='#60a5fa' fill='none'>" +
    "<path d='M186 50c-8-24 22-40 48-32 26 8 34 34 18 50-16 16-58 6-66-18Z' stroke-opacity='.12'/>" +
    "<path d='M198 50c-5-15 14-26 31-21 17 5 22 22 12 33-10 11-38 4-43-12Z' stroke-opacity='.17'/>" +
    "<path d='M210 50c-3-8 8-14 17-11 9 3 12 12 6 18-6 6-20 2-23-7Z' stroke-opacity='.12'/>" +
    "<path d='M60 30c14-18 44-20 58-4M42 74c20 12 52 10 68-6' stroke-opacity='.08'/>" +
    "<path d='M40 24h6M43 21v6M92 74h6M95 71v6M150 18h6M153 15v6' stroke-opacity='.16'/>" +
    '</g>' +
    '</svg>'
)

/** Blueprint sheet: a prototype airframe in plan view — dashed centerline,
 * registration crosses, a wingspan construction circle, photo-calibration
 * patches on the spine and a dimension line below. The FX layer pins its
 * beacons to this box, so its placement is mirrored there. */
const BETA_BLUEPRINT = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 220 80' preserveAspectRatio='xMaxYMid meet'>" +
    "<g stroke='#a8d8ff' fill='none' stroke-opacity='.3'>" +
    "<path d='M30 40H200' stroke-dasharray='7 5'/>" +
    "<path d='M32 14h8M36 10v8M198 62h8M202 58v8'/>" +
    "<path d='M48 69v6M190 69v6M48 72h142'/>" +
    '</g>' +
    "<path d='M48 40L74 35L100 33L154 11L161 15L148 33L170 35L184 25L189 28L176 37L190 40L176 43L189 52L184 55L170 45L148 47L161 65L154 69L100 47L74 45Z' fill='#7dd3fc' fill-opacity='.07' stroke='#a8d8ff' stroke-opacity='.8' stroke-width='1.5' stroke-linejoin='round'/>" +
    "<ellipse cx='84' cy='40' rx='7' ry='3' fill='none' stroke='#a8d8ff' stroke-opacity='.5'/>" +
    "<circle cx='154' cy='11' r='4.5' fill='none' stroke='#a8d8ff' stroke-opacity='.35'/>" +
    "<g fill='#fbbf24' fill-opacity='.5'><rect x='104' y='36' width='3.5' height='8'/><rect x='118' y='36' width='3.5' height='8'/></g>" +
    '</svg>'
)

/** Caution chevron tape along the bottom edge, brightening to the right. */
const BETA_CHEVRONS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 12'>" +
    "<g fill='none' stroke='#fbbf24' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M3 1.5L8 6L3 10.5' stroke-opacity='.12'/><path d='M16 1.5L21 6L16 10.5' stroke-opacity='.15'/><path d='M29 1.5L34 6L29 10.5' stroke-opacity='.18'/><path d='M42 1.5L47 6L42 10.5' stroke-opacity='.21'/><path d='M55 1.5L60 6L55 10.5' stroke-opacity='.24'/><path d='M68 1.5L73 6L68 10.5' stroke-opacity='.27'/><path d='M81 1.5L86 6L81 10.5' stroke-opacity='.31'/><path d='M94 1.5L99 6L94 10.5' stroke-opacity='.35'/><path d='M107 1.5L112 6L107 10.5' stroke-opacity='.39'/><path d='M120 1.5L125 6L120 10.5' stroke-opacity='.43'/><path d='M133 1.5L138 6L133 10.5' stroke-opacity='.47'/><path d='M146 1.5L151 6L146 10.5' stroke-opacity='.5'/>" +
    '</g>' +
    '</svg>'
)

/** Banknote-grade guilloché rosette, engraved in faint gold. */
const FOUNDER_GUILLOCHE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 140 140'>" +
    "<g stroke='#f5d06e' fill='none' stroke-width='.75'>" +
    "<circle cx='88' cy='70' r='36' stroke-opacity='.09'/><circle cx='82.7' cy='82.7' r='36' stroke-opacity='.09'/><circle cx='70' cy='88' r='36' stroke-opacity='.09'/><circle cx='57.3' cy='82.7' r='36' stroke-opacity='.09'/><circle cx='52' cy='70' r='36' stroke-opacity='.09'/><circle cx='57.3' cy='57.3' r='36' stroke-opacity='.09'/><circle cx='70' cy='52' r='36' stroke-opacity='.09'/><circle cx='82.7' cy='57.3' r='36' stroke-opacity='.09'/>" +
    "<circle cx='70' cy='70' r='57' stroke-opacity='.14'/><circle cx='70' cy='70' r='61' stroke-opacity='.07'/><circle cx='70' cy='70' r='9' stroke-opacity='.2'/>" +
    '</g>' +
    '</svg>'
)

/** Launch catalog. Order here is the default shop order: purchasable drops
 * first, then the Pro collection, then the Founder vault drop (sold from
 * its own band, not the grid) and the never-sold Beta tester gift. */
export const PLATES: PlateDef[] = [
  {
    id: 'synthwave-grid',
    name: 'Synthwave Grid',
    tagline: 'Ride the horizon straight into the grid.',
    rarity: 'rare',
    priceUsd: 3.99,
    render: {
      kind: 'css',
      base: [
        // ridge sits on the horizon (44% up); FX paints the scrolling floor below it
        `${SYNTHWAVE_RIDGE} left 0 bottom 44% / 100% 26% no-repeat`,
        `${SYNTHWAVE_STARS} 0 0 / 110px 46px repeat-x`,
        'radial-gradient(70% 90% at 78% 56%, rgb(255 45 149 / 0.3), transparent 62%)',
        // sunset bands with a hard stop at the horizon line
        'linear-gradient(180deg, rgb(10 4 30) 0%, rgb(34 9 58) 34%, rgb(92 20 92) 48%, rgb(178 40 110) 56%, rgb(24 7 40) 56.5%, rgb(11 4 22) 100%)'
      ],
      fx: 'synthwave-grid',
      accent: '255 45 149'
    }
  },
  {
    id: 'deep-space',
    name: 'Deep Space',
    tagline: 'Silent running past the last beacon.',
    rarity: 'common',
    priceUsd: 1.99,
    render: {
      kind: 'css',
      base: [
        `${SPACE_STARS} 0 0 / 140px 80px repeat`,
        'radial-gradient(80% 130% at 78% 18%, rgb(99 102 241 / 0.3), transparent 60%)',
        'radial-gradient(55% 100% at 52% 96%, rgb(192 38 211 / 0.14), transparent 65%)',
        'radial-gradient(45% 85% at 96% 74%, rgb(56 189 248 / 0.18), transparent 62%)',
        'linear-gradient(180deg, rgb(7 8 18), rgb(2 3 9))'
      ],
      fx: 'deep-space',
      accent: '129 140 248'
    }
  },
  {
    id: 'terminal-rain',
    name: 'Terminal Rain',
    tagline: 'The feed never stops falling.',
    rarity: 'rare',
    priceUsd: 3.99,
    render: {
      kind: 'css',
      base: [
        'radial-gradient(120% 180% at 88% 50%, rgb(2 254 1 / 0.14), transparent 62%)',
        'repeating-linear-gradient(90deg, rgb(2 254 1 / 0.03) 0 2px, transparent 2px 16px)',
        'repeating-linear-gradient(180deg, rgb(0 0 0 / 0.22) 0 1px, transparent 1px 3px)',
        'linear-gradient(180deg, rgb(3 12 6), rgb(1 6 3))'
      ],
      fx: 'terminal-rain',
      accent: '2 254 1'
    }
  },
  {
    id: 'koi-pond',
    name: 'Koi Pond',
    tagline: 'Still water. Perfect focus.',
    rarity: 'epic',
    priceUsd: 5.99,
    render: {
      kind: 'css',
      base: [
        `${KOI_PADS} right -10px top -4px / 230px 54px no-repeat`,
        'radial-gradient(130% 160% at 80% 20%, rgb(20 96 88 / 0.42), transparent 60%)',
        'radial-gradient(90% 140% at 60% 110%, rgb(12 60 66 / 0.55), transparent 70%)',
        'linear-gradient(180deg, rgb(7 28 30), rgb(3 14 17))'
      ],
      fx: 'koi-pond',
      accent: '255 122 60'
    }
  },
  {
    id: 'cherry-blossom',
    name: 'Cherry Blossom',
    tagline: "Petals fall. Rank doesn't.",
    rarity: 'epic',
    priceUsd: 5.99,
    render: {
      kind: 'css',
      base: [
        `${BLOSSOM_BRANCH} right -10px top -6px / 280px 97px no-repeat`,
        // full moon behind the branch
        'radial-gradient(circle at 76% 34%, rgb(255 236 244 / 0.95) 0 6px, rgb(255 190 215 / 0.4) 8px, rgb(255 154 194 / 0.12) 13px, transparent 20px)',
        'radial-gradient(110% 170% at 88% 22%, rgb(255 133 184 / 0.2), transparent 58%)',
        'radial-gradient(80% 120% at 64% 112%, rgb(126 62 146 / 0.3), transparent 66%)',
        'linear-gradient(180deg, rgb(30 11 34), rgb(14 6 20))'
      ],
      fx: 'cherry-blossom',
      accent: '255 154 194'
    }
  },
  {
    id: 'keyboard-cat',
    name: 'Keyboard Cat',
    tagline: 'Paws on keys, eyes on the crown.',
    rarity: 'common',
    priceUsd: 1.99,
    render: {
      kind: 'css',
      base: [
        `${CAT_KEYBOARD} right 6px bottom 0 / 200px 32px no-repeat`,
        'radial-gradient(90% 130% at 86% 0%, rgb(255 176 92 / 0.2), transparent 58%)',
        'radial-gradient(70% 110% at 100% 70%, rgb(139 118 255 / 0.14), transparent 60%)',
        'linear-gradient(180deg, rgb(20 14 30), rgb(10 7 17))'
      ],
      fx: 'keyboard-cat',
      accent: '255 176 92'
    }
  },
  {
    id: 'champions-gold',
    name: "Champion's Gold",
    tagline: 'Not for sale. Taken, by the #1 on the board.',
    rarity: 'legendary',
    priceUsd: null,
    championExclusive: true,
    render: {
      kind: 'css',
      base: [
        `${GOLD_TROPHY} right 10px center / 76px 57px no-repeat`,
        'repeating-conic-gradient(from 0deg at 82% 50%, rgb(255 214 68 / 0.05) 0deg 5deg, transparent 5deg 16deg)',
        'radial-gradient(60% 90% at 82% 46%, rgb(255 224 120 / 0.16), transparent 70%)',
        'radial-gradient(140% 190% at 84% 42%, rgb(255 190 40 / 0.22), rgb(255 152 0 / 0.06) 48%, transparent 68%)',
        'linear-gradient(180deg, transparent 78%, rgb(255 200 60 / 0.1) 92%, rgb(255 220 120 / 0.16))',
        'repeating-linear-gradient(135deg, rgb(255 214 68 / 0.05) 0 1px, transparent 1px 11px)',
        'linear-gradient(180deg, rgb(30 21 5), rgb(11 7 2))'
      ],
      fx: 'champions-gold',
      accent: '255 214 68'
    }
  },
  {
    id: 'season-01-ignition',
    name: 'Season 01: Ignition',
    tagline: 'First season. Full throttle.',
    rarity: 'legendary',
    priceUsd: 7.99,
    seasonal: { label: 'SEASON 01' },
    render: {
      kind: 'css',
      base: [
        `${IGNITION_CHECKER} right 0 bottom 0 / 168px 16px no-repeat`,
        'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.016) 0 2px, transparent 2px 6px)',
        'radial-gradient(120% 170% at 96% 60%, rgb(255 92 30 / 0.38), rgb(201 32 22 / 0.14) 46%, transparent 66%)',
        'linear-gradient(90deg, transparent 40%, rgb(255 64 22 / 0.08))',
        'linear-gradient(180deg, rgb(26 8 6), rgb(12 4 3))'
      ],
      fx: 'ignition',
      accent: '255 106 40'
    }
  },

  // ---- Pro collection — usable while a Pro subscription is active --------
  {
    id: 'pro-circuit',
    name: 'Pro Circuit',
    tagline: 'Signal routed straight to the top.',
    rarity: 'epic',
    priceUsd: null,
    proExclusive: true,
    render: {
      kind: 'css',
      base: [
        `${CIRCUIT_BOARD} right 0 center / auto 100% no-repeat`,
        'radial-gradient(110% 160% at 88% 40%, rgb(34 211 238 / 0.16), transparent 62%)',
        'repeating-linear-gradient(90deg, rgb(34 211 238 / 0.05) 0 1px, transparent 1px 19px)',
        'repeating-linear-gradient(0deg, rgb(34 211 238 / 0.05) 0 1px, transparent 1px 13px)',
        'linear-gradient(180deg, rgb(4 14 17), rgb(2 8 10))'
      ],
      fx: 'pro-circuit',
      accent: '34 211 238'
    }
  },
  {
    id: 'aurora-drift',
    name: 'Aurora Drift',
    tagline: 'High-altitude lights for high-altitude pilots.',
    rarity: 'epic',
    priceUsd: null,
    proExclusive: true,
    render: {
      kind: 'css',
      base: [
        `${AURORA_RIDGE} left 0 bottom 0 / 100% 30% no-repeat`,
        `${AURORA_STARS} 0 0 / 120px 60px repeat`,
        'radial-gradient(120% 185% at 82% 118%, rgb(30 58 138 / 0.35), transparent 62%)',
        'linear-gradient(180deg, rgb(5 9 22), rgb(2 4 12))'
      ],
      fx: 'aurora-drift',
      accent: '94 234 212'
    }
  },
  {
    id: 'midnight-ops',
    name: 'Midnight Ops',
    tagline: 'Fly dark. Land first.',
    rarity: 'epic',
    priceUsd: null,
    proExclusive: true,
    render: {
      kind: 'css',
      base: [
        `${OPS_TOPO} right 0 center / auto 118% no-repeat`,
        'radial-gradient(120% 160% at 86% 46%, rgb(59 130 246 / 0.13), transparent 60%)',
        'repeating-linear-gradient(90deg, rgb(148 180 255 / 0.035) 0 1px, transparent 1px 17px)',
        'repeating-linear-gradient(0deg, rgb(148 180 255 / 0.035) 0 1px, transparent 1px 17px)',
        'linear-gradient(180deg, rgb(5 9 18), rgb(2 4 9))'
      ],
      fx: 'midnight-ops',
      accent: '96 165 250'
    }
  },

  // ---- Founder — one-run vault drop: sold once, then retired forever -----
  {
    id: 'founder',
    name: 'Founder',
    tagline: 'Sold once. Never again. Etched in gold.',
    rarity: 'legendary',
    priceUsd: 9.99,
    render: {
      kind: 'css',
      base: [
        `${FOUNDER_GUILLOCHE} right -22px center / auto 155% no-repeat`,
        'radial-gradient(115% 170% at 90% 50%, rgb(255 214 68 / 0.16), transparent 58%)',
        'repeating-linear-gradient(115deg, rgb(255 214 68 / 0.05) 0 1px, transparent 1px 9px)',
        'linear-gradient(180deg, rgb(16 13 7), rgb(8 6 3))'
      ],
      fx: 'founder',
      accent: '245 208 110'
    }
  },

  // ---- Beta tester — gifted to invite-code signups, never sold -----------
  {
    id: 'beta-tester',
    name: 'Test Pilot',
    tagline: 'Flew the build before it was stable.',
    rarity: 'epic',
    priceUsd: null,
    betaExclusive: true,
    render: {
      kind: 'css',
      base: [
        // sheet + tape pinned in fixed px so the FX beacons (wingtip
        // strobes, telemetry lane) can mirror the same offsets exactly
        `${BETA_BLUEPRINT} right 10px center / 154px 56px no-repeat`,
        `${BETA_CHEVRONS} right 8px bottom 2px / 160px 12px no-repeat`,
        'radial-gradient(110% 160% at 86% 45%, rgb(56 148 255 / 0.15), transparent 62%)',
        // drafting grid: major lines every four minor cells
        'repeating-linear-gradient(90deg, rgb(168 216 255 / 0.07) 0 1px, transparent 1px 44px)',
        'repeating-linear-gradient(0deg, rgb(168 216 255 / 0.07) 0 1px, transparent 1px 44px)',
        'repeating-linear-gradient(90deg, rgb(168 216 255 / 0.035) 0 1px, transparent 1px 11px)',
        'repeating-linear-gradient(0deg, rgb(168 216 255 / 0.035) 0 1px, transparent 1px 11px)',
        'linear-gradient(180deg, rgb(8 24 46), rgb(4 12 26))'
      ],
      fx: 'beta-tester',
      accent: '125 211 252'
    }
  }
]

const PLATES_BY_ID = new Map(PLATES.map((plate) => [plate.id, plate]))

/** Catalog lookup — null for unknown/retired ids (callers render nothing). */
export function getPlate(id: string): PlateDef | null {
  return PLATES_BY_ID.get(id) ?? null
}
