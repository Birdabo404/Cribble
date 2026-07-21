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

export type PlateRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

/** Chip styling per rarity — mirrors the achievement rarity palette
 * (`--r-*` in globals.css), so plate chips match badge chips in both themes.
 * Mythic sits above legendary: the flat token is a white-violet fallback;
 * the shop's Reserve band upgrades its chip to an animated iridescent
 * treatment locally. */
export const PLATE_RARITY_META: Record<PlateRarity, { label: string; color: string }> = {
  common: { label: 'COMMON', color: 'rgb(var(--r-common))' },
  rare: { label: 'RARE', color: 'rgb(var(--r-rare))' },
  epic: { label: 'EPIC', color: 'rgb(var(--r-epic))' },
  legendary: { label: 'LEGENDARY', color: 'rgb(var(--r-legendary))' },
  mythic: { label: 'MYTHIC', color: 'rgb(var(--r-mythic))' }
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
  | 'event-horizon'
  | 'prime-anomaly'

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

/** Koi Pond caustic web — a cellular light net (wavy walls meeting at
 * brighter nodes), not blobs. Drawn once as shared path data and emitted
 * at two strengths: a faint full-plate tile baked into the base (so even
 * the name-fade zone reads as water) and an exported bright tile the FX
 * layer counter-drifts in two layers for live shimmer. The tile (160×80)
 * is seamless: the two horizontal walls enter/exit the side edges at
 * y=20/y=52, the two vertical links cross the top/bottom seam at x=30 and
 * x=110 with matched tangents. Cells are wide and flat — sunlight nets
 * stretch horizontally on gently moving water. */
const KOI_NET_PATHS =
  "<path d='M0 20C12 14 24 11.5 40 15.5C56 19.5 64 26 80 24C96 22 104 13.5 120 13.5C136 13.5 149 17 160 20'/>" +
  "<path d='M0 52C14 46 26 43.5 42 47.5C58 51.5 66 58 82 56C98 54 106 45.5 122 45.5C138 45.5 150 49 160 52'/>" +
  "<path d='M40 15.5C44.5 25.5 43 37.5 42 47.5'/>" +
  "<path d='M80 24C78.5 34 80 44 82 56'/>" +
  "<path d='M120 13.5C122 25.5 120.5 35.5 122 45.5'/>" +
  "<path d='M30 0C32 6 33 12 36.5 16.5'/>" +
  "<path d='M34 62C30.5 68 30 74 30 80'/>" +
  "<path d='M110 0C108 6 107.5 12 104.5 15'/>" +
  "<path d='M106 60C109 66.5 110 73 110 80'/>" +
  "<path d='M42 47.5C40 53 37.5 58 34 62'/>" +
  "<path d='M82 56C88 58.5 98 59.5 106 60'/>"

/** Short bright over-strokes hugging the intersections — caustic light
 * concentrates where cell walls meet, so the net sparkles at its joints. */
const KOI_NET_GLINTS =
  "<path d='M34 16.4C38 15 42 15 46 16.6'/><path d='M114 13.6C118 13.3 122 13.6 126 14.2'/>" +
  "<path d='M75 24.3C79 24.4 83 24 87 23.2'/><path d='M36 48.6C40 47.4 44 47.4 48 48.6'/>" +
  "<path d='M116 45.7C120 45.4 124 45.6 128 46.4'/><path d='M77 56.4C81 56.5 85 56 89 55.2'/>"

const KOI_NET_NODES =
  "<circle cx='40' cy='15.5' r='1.2'/><circle cx='80' cy='24' r='1.1'/><circle cx='120' cy='13.5' r='1.2'/>" +
  "<circle cx='42' cy='47.5' r='1.2'/><circle cx='82' cy='56' r='1.1'/><circle cx='122' cy='45.5' r='1.2'/>" +
  "<circle cx='36' cy='17' r='.8'/><circle cx='106' cy='60' r='.9'/><circle cx='34' cy='62' r='.9'/><circle cx='104.5' cy='15' r='.8'/>"

/** Each wall is drawn twice — a wide whisper stroke under a thin core —
 * so the net reads as soft refracted light with falloff, never as wire. */
const koiCausticSvg = (halo: number, core: number, glint: number, node: number) =>
  svg(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 80'>" +
      `<g fill='none' stroke='#bfffe9' stroke-width='3.4' stroke-opacity='${halo}' stroke-linecap='round'>` +
      KOI_NET_PATHS +
      '</g>' +
      `<g fill='none' stroke='#dcfff4' stroke-width='1.2' stroke-opacity='${core}' stroke-linecap='round'>` +
      KOI_NET_PATHS +
      '</g>' +
      `<g fill='none' stroke='#ecfffa' stroke-width='1.7' stroke-opacity='${glint}' stroke-linecap='round'>` +
      KOI_NET_GLINTS +
      '</g>' +
      `<g fill='#ecfffa' fill-opacity='${node}'>` +
      KOI_NET_NODES +
      '</g>' +
      '</svg>'
  )

/** Exported for the FX layer, which shows it at three strengths: a faint
 * static wash plus two live counter-drifting copies — all inside one mask
 * that dies toward the name zone, so no hairline ever crosses the text.
 * (Baking a faint tile into the base was tried and rejected: base layers
 * can't be masked, and even whisper-opacity walls read as scratches over
 * the calm dark left.) */
export const KOI_CAUSTICS = koiCausticSvg(0.09, 0.18, 0.32, 0.36)

/** Pebble bed hugging the bottom edge — the pond floor read through the
 * water. One pebble straddles the tile seam (split into an x=0 / x=230
 * pair) so the repeat-x never shows a bald joint; faint top-edge arcs
 * catch the light from above. */
const KOI_PEBBLES = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 230 30'>" +
    "<ellipse cx='0' cy='28' rx='9' ry='4.5' fill='#12474c' fill-opacity='.32'/>" +
    "<ellipse cx='230' cy='28' rx='9' ry='4.5' fill='#12474c' fill-opacity='.32'/>" +
    "<ellipse cx='17' cy='26.5' rx='12' ry='5' fill='#0f4148' fill-opacity='.34'/>" +
    "<ellipse cx='38' cy='29' rx='7' ry='3.6' fill='#175a5c' fill-opacity='.28'/>" +
    "<ellipse cx='58' cy='26' rx='13' ry='5.5' fill='#124449' fill-opacity='.34'/>" +
    "<ellipse cx='81' cy='28.5' rx='8' ry='4' fill='#1a6660' fill-opacity='.24'/>" +
    "<ellipse cx='103' cy='26.5' rx='11' ry='4.8' fill='#0f4148' fill-opacity='.32'/>" +
    "<ellipse cx='125' cy='29' rx='7.5' ry='3.8' fill='#175a5c' fill-opacity='.28'/>" +
    "<ellipse cx='146' cy='26' rx='13' ry='5.2' fill='#12474c' fill-opacity='.32'/>" +
    "<ellipse cx='170' cy='28.5' rx='8.5' ry='4.2' fill='#1a6660' fill-opacity='.24'/>" +
    "<ellipse cx='191' cy='26.5' rx='11' ry='4.8' fill='#0f4148' fill-opacity='.32'/>" +
    "<ellipse cx='212' cy='29' rx='7' ry='3.6' fill='#175a5c' fill-opacity='.26'/>" +
    "<g fill='none' stroke='#9fecd4' stroke-opacity='.1' stroke-width='.9'>" +
    "<path d='M9 24.4A12 5 0 0 1 24 24.6'/><path d='M48 23.6A13 5.5 0 0 1 66 23.8'/><path d='M95 24.4A11 4.8 0 0 1 110 24.6'/><path d='M137 24A13 5.2 0 0 1 154 24.2'/><path d='M183 24.4A11 4.8 0 0 1 198 24.6'/>" +
    '</g>' +
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

/** Dim cool starfield tile behind the Event Horizon (far, unlensed field). */
const HORIZON_STARS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 150 84'>" +
    "<g fill='#dbe4ff'><circle cx='14' cy='16' r='0.9' fill-opacity='.4'/><circle cx='52' cy='8' r='0.6' fill-opacity='.3'/><circle cx='96' cy='20' r='1' fill-opacity='.42'/><circle cx='128' cy='10' r='0.7' fill-opacity='.3'/><circle cx='30' cy='44' r='0.7' fill-opacity='.26'/><circle cx='74' cy='56' r='0.9' fill-opacity='.34'/><circle cx='116' cy='48' r='0.6' fill-opacity='.24'/><circle cx='40' cy='72' r='0.8' fill-opacity='.3'/><circle cx='138' cy='70' r='0.9' fill-opacity='.36'/></g>" +
    '</svg>'
)

/** Gargantua. Near-edge-on thin accretion disk drawn to actual black-hole
 * imaging (Luminet / EHT / Interstellar's DNGR renders), camera slightly
 * above the disk plane: a doppler-graded annulus (approaching left limb
 * white-hot from relativistic beaming, receding right limb absorbed into
 * red dust) textured with dashed filament striations, the far side of the
 * disk gravitationally lensed into a bright arch OVER the shadow and a
 * smaller, dimmer arch UNDER it (peaks ±~28px so the full halo survives a
 * 68px leaderboard row), a pure-black shadow hugged by a razor photon ring
 * with a red/blue chromatic fringe pair and a faint second-order echo
 * ring, the near-side band crossing IN FRONT slightly below center, dust
 * wisps tearing off both limbs, and background stars smeared into arcs.
 * Palette: cream core → peach/salmon → dusty rose-brown fringe.
 * Hole center sits at (260,85) of the 360×170 box — at the catalog
 * placement (360px wide, right -4px) that lands the well 96px from the
 * right edge; the FX layer pins its shear bands, infall spirals and the
 * 45s tidal-disruption event to the same point. */
const EVENT_HORIZON_CORE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 170'>" +
    "<defs><radialGradient id='ehd' gradientUnits='userSpaceOnUse' cx='280' cy='85' r='120' gradientTransform='translate(280 85) scale(1 .13) translate(-280 -85)'>" +
    "<stop offset='.16' stop-color='#fff8ee' stop-opacity='.92'/>" +
    "<stop offset='.32' stop-color='#ffe2bd' stop-opacity='.8'/>" +
    "<stop offset='.52' stop-color='#ffb583' stop-opacity='.52'/>" +
    "<stop offset='.72' stop-color='#c67a52' stop-opacity='.3'/>" +
    "<stop offset='.9' stop-color='#8a4f38' stop-opacity='.13'/>" +
    "<stop offset='1' stop-color='#6b3d2e' stop-opacity='0'/>" +
    '</radialGradient></defs>' +
    // background stars smeared into faint concentric arcs by the lens
    "<g stroke='#cdd8ff' fill='none' stroke-width='.9'>" +
    "<path d='M254 55a40 40 0 0 1 36 -9' stroke-opacity='.13'/>" +
    "<path d='M319 64a34 34 0 0 1 8 17' stroke-opacity='.1'/>" +
    "<path d='M308 116a38 38 0 0 1 -31 8' stroke-opacity='.11'/>" +
    '</g>' +
    "<g fill='#ffeeda'>" +
    "<circle cx='257' cy='60' r='.8' fill-opacity='.55'/><circle cx='280' cy='53' r='.7' fill-opacity='.5'/><circle cx='304' cy='61' r='.8' fill-opacity='.5'/>" +
    "<circle cx='316' cy='85' r='.7' fill-opacity='.4'/><circle cx='303' cy='112' r='.8' fill-opacity='.5'/><circle cx='279' cy='119' r='.7' fill-opacity='.45'/><circle cx='255' cy='111' r='.8' fill-opacity='.45'/><circle cx='245' cy='85' r='.7' fill-opacity='.4'/>" +
    '</g>' +
    "<g transform='rotate(-8 280 85)'>" +
    // outermost fringe: the disk dissolving into torn dust filaments
    "<ellipse cx='280' cy='85' rx='131' ry='17' fill='none' stroke='#8a5038' stroke-opacity='.16' stroke-width='4.5' stroke-dasharray='58 36 88 30'/>" +
    "<ellipse cx='280' cy='85' rx='143' ry='18.6' fill='none' stroke='#75432f' stroke-opacity='.1' stroke-width='4' stroke-dasharray='40 56 66 44'/>" +
    "<path d='M132 78c24 -2 44 0 64 4' stroke='#c07a54' stroke-opacity='.22' stroke-width='2.2' fill='none'/>" +
    "<path d='M120 90c30 1 54 2 76 -1' stroke='#9a563c' stroke-opacity='.18' stroke-width='2.6' fill='none'/>" +
    "<path d='M352 96c18 3 32 8 44 15' stroke='#7c4530' stroke-opacity='.14' stroke-width='2.4' fill='none'/>" +
    // the disk: one continuous graded annulus (a slim ISCO gap inside)…
    "<path fill='url(#ehd)' fill-rule='evenodd' d='M160 85a120 15.6 0 1 0 240 0a120 15.6 0 1 0 -240 0M261 85a19 2.5 0 1 0 38 0a19 2.5 0 1 0 -38 0Z'/>" +
    // …textured by dashed shear filaments, never clean whole rings
    "<g fill='none'>" +
    "<ellipse cx='280' cy='85' rx='109' ry='14.2' stroke='#b56a48' stroke-opacity='.3' stroke-width='2.6' stroke-dasharray='78 26 118 30'/>" +
    "<ellipse cx='280' cy='85' rx='95' ry='12.4' stroke='#e8905e' stroke-opacity='.3' stroke-width='2.2' stroke-dasharray='108 24 68 36'/>" +
    "<ellipse cx='280' cy='85' rx='81' ry='10.5' stroke='#ffc79a' stroke-opacity='.34' stroke-width='2' stroke-dasharray='88 20 138 24'/>" +
    "<ellipse cx='280' cy='85' rx='67' ry='8.7' stroke='#ffe0bd' stroke-opacity='.4' stroke-width='1.8' stroke-dasharray='118 18 78 22'/>" +
    "<ellipse cx='280' cy='85' rx='53' ry='6.9' stroke='#fff0d9' stroke-opacity='.46' stroke-width='1.6' stroke-dasharray='138 14 88 18'/>" +
    "<ellipse cx='280' cy='85' rx='41' ry='5.3' stroke='#fff7ea' stroke-opacity='.5' stroke-width='1.4'/>" +
    "<ellipse cx='280' cy='85' rx='32' ry='4.15' stroke='#fffdf6' stroke-opacity='.6' stroke-width='1.3'/>" +
    '</g>' +
    // relativistic beaming: the approaching limb burns white-hot…
    "<ellipse cx='200' cy='86' rx='60' ry='8' fill='#fff6ea' fill-opacity='.42'/>" +
    "<ellipse cx='206' cy='86' rx='40' ry='5.2' fill='#ffffff' fill-opacity='.5'/>" +
    "<ellipse cx='212' cy='86.5' rx='24' ry='3' fill='#ffffff' fill-opacity='.65'/>" +
    // …while the receding limb reddens into dust
    "<ellipse cx='356' cy='84' rx='46' ry='8' fill='#2a1109' fill-opacity='.58'/>" +
    "<ellipse cx='336' cy='87' rx='26' ry='4' fill='#1f0d07' fill-opacity='.24'/>" +
    // the lensing signature: the far side lensed into a TIGHT halo hugging
    // the shadow — a bright dome arching over (roots dive into the disk on
    // both sides) with a soft bloom above it…
    "<path d='M264.1 86.9A16 16 0 1 1 295.9 86.9' fill='none' stroke='#ffd9ae' stroke-opacity='.32' stroke-width='5'/>" +
    "<path d='M264.3 86.5A15.7 15.7 0 1 1 295.7 86.5' fill='none' stroke='#ffedd6' stroke-opacity='.52' stroke-width='2.6'/>" +
    "<path d='M264.6 86.2A15.4 15.4 0 1 1 295.4 86.2' fill='none' stroke='#fff8ee' stroke-opacity='.85' stroke-width='1.4'/>" +
    "<ellipse cx='280' cy='69.5' rx='11' ry='4.2' fill='#fff3e0' fill-opacity='.16'/>" +
    "<ellipse cx='280' cy='70.2' rx='6' ry='1.9' fill='#fffdf8' fill-opacity='.3'/>" +
    // …and a smaller, dimmer counter-arch under (second image, near side)
    "<path d='M266.6 80.3A14.8 14.8 0 1 0 293.4 80.3' fill='none' stroke='#ffd9b0' stroke-opacity='.28' stroke-width='4'/>" +
    "<path d='M266.9 80.6A14.5 14.5 0 1 0 293.1 80.6' fill='none' stroke='#ffeed9' stroke-opacity='.48' stroke-width='2.2'/>" +
    "<path d='M267.2 80.9A14.2 14.2 0 1 0 292.8 80.9' fill='none' stroke='#fff6ea' stroke-opacity='.66' stroke-width='1.1'/>" +
    // the shadow — photon capture cross-section, nothing comes back
    "<circle cx='280' cy='85' r='12.4' fill='#000004'/>" +
    // razor photon ring + red/blue chromatic fringe pair
    "<circle cx='280' cy='85' r='13.3' fill='none' stroke='#fff8ee' stroke-opacity='.95' stroke-width='1.4'/>" +
    "<circle cx='280' cy='85' r='14.3' fill='none' stroke='#ffb28a' stroke-opacity='.3' stroke-width='.9'/>" +
    "<circle cx='280' cy='85' r='12.5' fill='none' stroke='#a8bdff' stroke-opacity='.24' stroke-width='.7'/>" +
    // the near-side band crossing IN FRONT, doppler-loaded to the left,
    // long enough to bridge the ISCO gap into the disk on both sides
    "<ellipse cx='280' cy='88.8' rx='47' ry='3.4' fill='#fff3e0' fill-opacity='.48'/>" +
    "<ellipse cx='262' cy='88.4' rx='26' ry='2.1' fill='#ffffff' fill-opacity='.5'/>" +
    '</g>' +
    '</svg>'
)

/** Cold starfield behind the Prime Anomaly — cyan/violet-tinted so the
 * field reads as the anomaly's own sky, not the Event Horizon's warm one.
 * Large jittered tile (170×92) so the repeat never reads as a lattice. */
const ANOMALY_STARS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 170 92'>" +
    "<g fill='#dff6ff'><circle cx='18' cy='14' r='0.9' fill-opacity='.38'/><circle cx='66' cy='9' r='0.6' fill-opacity='.26'/><circle cx='114' cy='18' r='1' fill-opacity='.4'/><circle cx='152' cy='30' r='0.7' fill-opacity='.28'/><circle cx='88' cy='50' r='0.8' fill-opacity='.3'/><circle cx='36' cy='62' r='0.7' fill-opacity='.24'/><circle cx='132' cy='68' r='0.9' fill-opacity='.34'/><circle cx='58' cy='84' r='0.6' fill-opacity='.22'/></g>" +
    "<g fill='#cfc4ff'><circle cx='44' cy='34' r='0.7' fill-opacity='.3'/><circle cx='102' cy='80' r='0.8' fill-opacity='.3'/><circle cx='160' cy='84' r='0.6' fill-opacity='.24'/></g>" +
    // one 4-point glint per tile — the field twinkles without animating
    "<path d='M138 42l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z' fill='#eafcff' fill-opacity='.4'/>" +
    '</svg>'
)

/** Two worlds adrift right of the rift: a ringed gas giant rim-lit on its
 * rift-facing (left) side by the anomaly's glow, and a small dusty-rose
 * moon below. Kept right of the seam so the burst rays rake past them —
 * scenery, never competition. */
const ANOMALY_PLANETS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 190 110'>" +
    // gas giant: violet-indigo body, cyan rim light toward the seam,
    // banded latitudes, ring tilted behind then in front
    "<ellipse cx='138' cy='34' rx='26' ry='7' fill='none' stroke='#9aa4e8' stroke-opacity='.28' stroke-width='1.6' transform='rotate(-16 138 34)'/>" +
    "<circle cx='138' cy='34' r='12.5' fill='#232048'/>" +
    "<circle cx='138' cy='34' r='12.5' fill='none' stroke='#7df4ff' stroke-opacity='.4' stroke-width='1' stroke-dasharray='26 53'  stroke-dashoffset='6'/>" +
    "<path d='M126.5 30a12.5 12.5 0 0 1 5-7.6' stroke='#bfefff' stroke-opacity='.55' stroke-width='1.4' fill='none'/>" +
    "<path d='M127 38.5h22M128.5 42.5h19M127.5 34.5h21' stroke='#8f86d8' stroke-opacity='.3' stroke-width='1.6'/>" +
    "<ellipse cx='138' cy='34' rx='26' ry='7' fill='none' stroke='#b8c0f4' stroke-opacity='.4' stroke-width='1.6' transform='rotate(-16 138 34)' stroke-dasharray='41 82' stroke-dashoffset='-8'/>" +
    // small dusty-rose moon — its crescent is the RIFT's light reflected,
    // so it carries the rift's icy tint, not its own pink
    "<circle cx='52' cy='78' r='5' fill='#3a2233'/>" +
    "<path d='M48.4 74.6a5 5 0 0 1 2.4-1.5' stroke='#bff4ff' stroke-opacity='.55' stroke-width='1.2' fill='none'/>" +
    "<circle cx='52' cy='78' r='5' fill='none' stroke='#bff4ff' stroke-opacity='.14' stroke-width='.8'/>" +
    '</svg>'
)

/** Prime Anomaly containment cracks: thin electric filaments radiating from
 * the seam center (130,60), elbowed like stress fractures. Bright white
 * nucleus segments near the center, cyan arms thinning outward, dim violet
 * strays — the sealed panel barely holding. Long near-horizontal east arm
 * keeps the motif legible in the 68px row crop; west arms stay short and
 * faint so the name zone stays quiet. Exported: the FX layer re-uses this
 * exact tile as the mask of its shimmering "veins" glow so the etched art
 * and the glow can never drift apart. */
export const ANOMALY_CRACKS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 260 120'>" +
    "<g stroke='#7df4ff' fill='none' stroke-width='1'>" +
    "<path d='M130 60L148 48L156 50L178 34L182 35L206 18' stroke-opacity='.34'/>" +
    "<path d='M130 60L158 62L166 58L196 60L204 57L236 60' stroke-opacity='.38'/>" +
    "<path d='M130 60L150 74L158 72L176 86L186 84L206 98' stroke-opacity='.32'/>" +
    "<path d='M130 60L134 44L130 38L136 20L133 12' stroke-opacity='.3'/>" +
    "<path d='M130 60L126 76L131 84L125 102' stroke-opacity='.28'/>" +
    "<path d='M130 60L112 54L104 57L88 48' stroke-opacity='.15'/>" +
    "<path d='M166 58L172 50' stroke-opacity='.18' stroke-width='.8'/>" +
    "<path d='M158 72L168 76' stroke-opacity='.16' stroke-width='.8'/>" +
    '</g>' +
    "<g stroke='#a99cff' fill='none' stroke-width='.9'>" +
    "<path d='M130 60L118 42L112 40L102 28' stroke-opacity='.16'/>" +
    "<path d='M130 60L114 68L106 66L94 74' stroke-opacity='.14'/>" +
    "<path d='M148 48L154 40' stroke-opacity='.2'/>" +
    '</g>' +
    "<g stroke='#eafcff' fill='none' stroke-width='1.2'>" +
    "<path d='M130 60L148 48' stroke-opacity='.58'/>" +
    "<path d='M130 60L158 62' stroke-opacity='.62'/>" +
    "<path d='M130 60L150 74' stroke-opacity='.56'/>" +
    "<path d='M130 60L134 44' stroke-opacity='.55'/>" +
    "<path d='M130 60L126 76' stroke-opacity='.5'/>" +
    '</g>' +
    "<circle cx='130' cy='60' r='1.8' fill='#f4feff' fill-opacity='.75'/>" +
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

  // ---- The Reserve — mythic class. Sold from the shop's Reserve shelf,
  // never the grid. Three lanes: living water (the koi pond), living
  // scene (black hole), flagship (reality tear). -------------------------
  {
    id: 'koi-pond',
    name: 'Koi Pond',
    tagline: 'Still water. Perfect focus.',
    rarity: 'mythic',
    priceUsd: 15,
    render: {
      kind: 'css',
      base: [
        `${KOI_PEBBLES} left 0 bottom -9px / 230px 30px repeat-x`,
        // sun enters top-right: a warm-aqua pool where the light lands,
        // a deep vignette in the lower-left where the identity text sits
        'radial-gradient(72% 150% at 88% -12%, rgb(104 232 196 / 0.44), rgb(48 184 156 / 0.2) 46%, transparent 66%)',
        'radial-gradient(80% 130% at 6% 115%, rgb(2 24 30 / 0.44), transparent 55%)',
        'linear-gradient(104deg, rgb(6 46 50) 0%, rgb(10 70 68) 28%, rgb(14 94 88) 55%, rgb(20 124 110) 80%, rgb(30 154 138) 100%)'
      ],
      fx: 'koi-pond',
      accent: '255 122 60'
    }
  },
  {
    id: 'event-horizon',
    name: 'Event Horizon',
    tagline: 'Gravity always wins. Be the gravity.',
    rarity: 'mythic',
    priceUsd: 20,
    render: {
      kind: 'css',
      base: [
        // Gargantua at native scale: the 400×170 box at right -24px lands
        // the hole center (280,85) exactly 96px from the right edge — the
        // FX layer pins its shear bands, infall spirals and the 45s tidal
        // disruption to the same point
        `${EVENT_HORIZON_CORE} right -24px center / 400px 170px no-repeat`,
        `${HORIZON_STARS} 0 0 / 150px 84px repeat`,
        // doppler bloom biased to the approaching (left) limb of the well,
        // a dusty rose exhale under the disk plane, cold interstellar blue
        // in the far upper-left
        'radial-gradient(150px 56px at calc(100% - 128px) 51%, rgb(255 208 165 / 0.14), transparent 70%)',
        'radial-gradient(240px 110px at calc(100% - 96px) 58%, rgb(200 110 70 / 0.1), transparent 72%)',
        'radial-gradient(70% 130% at 12% 0%, rgb(30 41 90 / 0.28), transparent 62%)',
        'linear-gradient(180deg, rgb(5 4 10), rgb(1 1 4))'
      ],
      fx: 'event-horizon',
      accent: '255 199 122'
    }
  },
  {
    id: 'prime-anomaly',
    name: 'Prime Anomaly',
    tagline: 'Wrong build. Wrong universe. Right rank.',
    rarity: 'mythic',
    priceUsd: 30,
    render: {
      kind: 'css',
      base: [
        // chromatic seam right-of-center (64%): cyan fringe / white core /
        // magenta dispersion fringe — the sealed-state tell the FX tear
        // opens along (pink exists ONLY as this aberration hairline)
        'linear-gradient(180deg, transparent 4%, rgb(125 244 255 / 0.36) 30%, rgb(125 244 255 / 0.1) 68%, transparent 96%) calc(64% - 2px) 0 / 1px 100% no-repeat',
        'linear-gradient(180deg, transparent 6%, rgb(240 253 255 / 0.6) 32%, rgb(240 253 255 / 0.18) 66%, transparent 94%) 64% 0 / 1px 100% no-repeat',
        'linear-gradient(180deg, transparent 4%, rgb(255 79 216 / 0.26) 34%, rgb(255 79 216 / 0.08) 70%, transparent 96%) calc(64% + 2px) 0 / 1px 100% no-repeat',
        // containment cracks etched around the seam. Position math: a
        // background-position % resolves against (box − image), so
        // `calc(64% + 36.4px)` = 0.64·(W−260) + 0.64·260 − 130 + 130 lands
        // the tile's center (130,60) exactly on the 64% seam at any width.
        `${ANOMALY_CRACKS} calc(64% + 36.4px) center / 260px 120px no-repeat`,
        'radial-gradient(30% 90% at 64% 50%, rgb(125 244 255 / 0.08), transparent 70%)',
        // the sky the anomaly hangs in: two worlds right of the rift (the
        // burst rays rake past them), a cold star tile, a violet nebula
        // breath in the upper-right — the left third stays near-black
        `${ANOMALY_PLANETS} right 4px center / 190px 110px no-repeat`,
        `${ANOMALY_STARS} 0 0 / 170px 92px repeat`,
        'radial-gradient(60% 110% at 88% 6%, rgb(91 74 176 / 0.14), transparent 62%)',
        'linear-gradient(180deg, rgb(9 11 15), rgb(4 5 8))'
      ],
      fx: 'prime-anomaly',
      accent: '165 243 252'
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
