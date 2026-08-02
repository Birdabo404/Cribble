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

/** Sakura blossom anatomy, drawn once and <use>d across the branch. The
 * petal (sb-pt) is the real thing: obovate with the signature cleft at
 * the outer tip (the two lobes peak at ±1.8, the notch dips to −6.2),
 * a white-heart radial blush, and a faint center crease (sb-cr). The
 * front flower (sb-fl) rings five petals around a full stamen burst —
 * crimson filaments with dot anthers and one greenish pistil — while
 * sb-fl2 is the simpler deep-pink flower that pads cluster backs so the
 * detailed fronts stay in crisp focus. Buds (sb-bud) are closed teardrops
 * with a sepal fork; sb-half is a two-petal cup just opening. */
const SAKURA_PARTS_DEFS =
  '<defs>' +
  "<radialGradient id='sb-pg' cx='.5' cy='.38' r='.8'>" +
  "<stop offset='0' stop-color='#ffffff'/><stop offset='.42' stop-color='#ffc9db'/><stop offset='1' stop-color='#ff8fbc'/>" +
  '</radialGradient>' +
  "<radialGradient id='sb-pg2' cx='.5' cy='.38' r='.8'>" +
  "<stop offset='0' stop-color='#ffc9da'/><stop offset='1' stop-color='#ef74a8'/>" +
  '</radialGradient>' +
  "<radialGradient id='sb-budg' cx='.5' cy='.3' r='.9'>" +
  "<stop offset='0' stop-color='#ffb1cd'/><stop offset='1' stop-color='#e8649a'/>" +
  '</radialGradient>' +
  "<linearGradient id='sb-bark' x1='0' y1='0' x2='0' y2='1'>" +
  "<stop offset='0' stop-color='#5d3d2c'/><stop offset='.5' stop-color='#402a1c'/><stop offset='1' stop-color='#2b1710'/>" +
  '</linearGradient>' +
  "<path id='sb-pt' d='M0 0C-4 -.6 -6.2 -2.8 -5.3 -5.2C-4.7 -6.9 -3.1 -8 -2 -7.3C-1.3 -6.9 -.7 -6.8 0 -6.3C.7 -6.8 1.3 -6.9 2 -7.3C3.1 -8 4.7 -6.9 5.3 -5.2C6.2 -2.8 4 -.6 0 0Z'/>" +
  "<path id='sb-cr' d='M0 -.8C-.2 -2.8 -.2 -4.6 0 -6'/>" +
  "<g id='sb-fl'>" +
  "<use href='#sb-pt' fill='url(#sb-pg)' stroke='#e2689a' stroke-width='.3' stroke-opacity='.45'/><use href='#sb-pt' fill='url(#sb-pg)' stroke='#e2689a' stroke-width='.3' stroke-opacity='.45' transform='rotate(72)'/><use href='#sb-pt' fill='url(#sb-pg)' stroke='#e2689a' stroke-width='.3' stroke-opacity='.45' transform='rotate(144)'/><use href='#sb-pt' fill='url(#sb-pg)' stroke='#e2689a' stroke-width='.3' stroke-opacity='.45' transform='rotate(216)'/><use href='#sb-pt' fill='url(#sb-pg)' stroke='#e2689a' stroke-width='.3' stroke-opacity='.45' transform='rotate(288)'/>" +
  "<g stroke='#e89bbb' stroke-width='.38' fill='none' opacity='.5'>" +
  "<use href='#sb-cr'/><use href='#sb-cr' transform='rotate(72)'/><use href='#sb-cr' transform='rotate(144)'/><use href='#sb-cr' transform='rotate(216)'/><use href='#sb-cr' transform='rotate(288)'/>" +
  '</g>' +
  "<circle r='.85' fill='#fff4f8' opacity='.7'/>" +
  "<g stroke='#c94f74' stroke-width='.4' stroke-linecap='round' fill='none' opacity='.9'>" +
  "<path d='M0 -.3V-2.6M1.6 -.9L2.4 -2.2M-1.6 -.9L-2.4 -2.2M2.3 .5L3.3 -.6M-2.3 .5L-3.3 -.6M1.8 1.7L2.7 .9'/>" +
  '</g>' +
  "<g fill='#b83a63'>" +
  "<circle cy='-2.7' r='.45'/><circle cx='2.4' cy='-2.3' r='.45'/><circle cx='-2.4' cy='-2.3' r='.45'/><circle cx='3.4' cy='-.7' r='.45'/><circle cx='-3.4' cy='-.7' r='.45'/><circle cx='2.8' cy='.8' r='.45'/>" +
  '</g>' +
  '</g>' +
  "<g id='sb-fl2'>" +
  "<use href='#sb-pt' fill='url(#sb-pg2)'/><use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(72)'/><use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(144)'/><use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(216)'/><use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(288)'/>" +
  "<circle r='1' fill='#f2557f' opacity='.8'/>" +
  '</g>' +
  "<g id='sb-bud'>" +
  "<path d='M0 0L-1.6 1.8M0 0L1.4 1.9' stroke='#7a4a2c' stroke-width='.7' fill='none'/>" +
  "<path d='M0 -.4C-2.4 -1 -3 -3 -2 -4.8C-1.2 -6.2 1.2 -6.2 2 -4.8C3 -3 2.4 -1 0 -.4Z' fill='url(#sb-budg)'/>" +
  '</g>' +
  "<g id='sb-half'>" +
  "<use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(-42) scale(.92)'/>" +
  "<use href='#sb-pt' fill='url(#sb-pg2)' transform='rotate(42) scale(.92)'/>" +
  "<ellipse cy='-1.6' rx='1.7' ry='1.3' fill='#d7557f' opacity='.7'/>" +
  "<path d='M0 -1.6L-.8 -3.4M0 -1.6L.9 -3.3M0 -1.6V-3.8' stroke='#c22356' stroke-width='.45' stroke-linecap='round' fill='none'/>" +
  '</g>' +
  '</defs>'

/** The hanami branch: a gnarled limb reaching in from the top-right
 * corner, tapering as it sweeps down-left, carrying four blossom
 * clusters and a drooping twig that hangs over the kana signature so
 * the lettering reads as part of the tree, not a sticker on the sky.
 * Composition is deliberately top-heavy: on the shortest strips (~68px
 * rows) only sky ever crops, never a cluster. Bark is two-tone — a
 * warm lit ridge along the top edge over a dark crease below — with
 * growth knots and grain strokes. Clusters are built back-to-front:
 * a soft halo knit, deep sb-fl2 padding, crisp sb-fl faces, then buds
 * and half-open cups at the fringes where real flower balls thin out.
 * Three painted petals trail off the canopy — the moment before the
 * FX layer's fall takes over. The lower-right quadrant (x>235, y>48)
 * stays empty: the クリブル column lives there. */
const SAKURA_BRANCH = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 110'>" +
    SAKURA_PARTS_DEFS +
    // limb silhouette: enters at the corner ~14px thick, tapers to a point
    "<path d='M300 3C268 8 240 12 214 22C186 33 158 40 128 46C118 48 109 49 101 50C112 54 128 53 146 49C176 42 204 34 228 25C252 17 276 15 300 17Z' fill='url(#sb-bark)'/>" +
    "<path d='M300 3.5C268 8.5 240 12.5 214 22.5C186 33.5 158 40.5 128 46.5' stroke='#6f4a34' stroke-width='1.5' fill='none' opacity='.7'/>" +
    "<path d='M300 16.5C276 15 252 17.5 228 25.5C204 34.5 176 42.5 146 49.5' stroke='#241209' stroke-width='1.3' fill='none' opacity='.8'/>" +
    "<g stroke='#57392a' stroke-width='.8' fill='none' opacity='.7'>" +
    "<path d='M262 12C250 14 238 17 226 21'/><path d='M206 27C194 31 182 35 170 38'/><path d='M150 43C140 45.5 130 47 120 48'/>" +
    "<path d='M250 14C240 16 230 19 220 23'/><path d='M190 32C180 35.5 170 38 160 41'/><path d='M136 46C128 47.5 120 48.5 112 49.5'/>" +
    '</g>' +
    // lenticels — the horizontal banding that makes cherry bark cherry
    "<g stroke='#2c1810' stroke-width='.7' fill='none' opacity='.45'>" +
    "<path d='M268 9.5h6'/><path d='M240 15.5h7'/><path d='M222 21h5.5'/><path d='M198 30h6'/><path d='M172 38.5h5'/><path d='M148 45.5h4.5'/>" +
    '</g>' +
    "<g stroke='#8a6647' stroke-width='.5' fill='none' opacity='.4'>" +
    "<path d='M266 11h4'/><path d='M238 17h5'/><path d='M196 31.6h4.5'/><path d='M146 47h3.5'/>" +
    '</g>' +
    // knots and burls — the gnarl that rewards a close look
    "<ellipse cx='236' cy='23' rx='3' ry='2' fill='#2c1810'/>" +
    "<path d='M233.5 21.5A3 2 0 0 1 238.5 21.8' stroke='#6f4a34' stroke-width='.7' fill='none' opacity='.7'/>" +
    "<ellipse cx='208' cy='28' rx='2.2' ry='1.5' fill='#2c1810'/>" +
    "<path d='M206.2 26.8A2.2 1.5 0 0 1 209.8 27' stroke='#6f4a34' stroke-width='.6' fill='none' opacity='.65'/>" +
    "<ellipse cx='162' cy='41' rx='1.8' ry='1.2' fill='#2c1810' opacity='.9'/>" +
    // lichen + moss flecks on the shaded side of the limb
    "<g fill='#8ba368' opacity='.5'>" +
    "<circle cx='232' cy='19.5' r='1.1'/><circle cx='186' cy='33.5' r='.9'/><circle cx='158' cy='42.5' r='.7'/>" +
    '</g>' +
    "<g fill='#a3b57c' opacity='.45'>" +
    "<circle cx='218' cy='25.5' r='.8'/><circle cx='230' cy='20.8' r='.5'/><circle cx='184' cy='34.8' r='.45'/>" +
    '</g>' +
    // twigs (round caps read as young wood) — mains plus the fork and
    // the fine year-old wood that carries next spring's buds
    "<g stroke='#382217' fill='none' stroke-linecap='round'>" +
    "<path d='M230 18C222 10 212 5 202 3' stroke-width='2.6'/>" +
    "<path d='M252 13C258 6 266 2 276 0' stroke-width='2.2'/>" +
    "<path d='M196 31C190 40 182 48 172 54' stroke-width='2'/>" +
    "<path d='M128 47C121 51 114 54 108 57' stroke-width='1.6'/>" +
    "<path d='M160 42C154 35 146 31 138 29' stroke-width='1.3'/>" +
    "<path d='M258 17C254 26 250 34 248 43' stroke-width='1.4'/>" +
    "<path d='M214 22C204 16 194 13 184 12' stroke-width='2.4'/>" +
    "<path d='M176 36C172 32 169 29 167 26' stroke-width='1.1'/>" +
    "<path d='M144 44C142 47 141 50 140 52' stroke-width='1'/>" +
    '</g>' +
    // corner canopy — the dense pink mass against blue
    "<ellipse cx='266' cy='18' rx='36' ry='23' fill='#ffb9d4' opacity='.32'/>" +
    "<use href='#sb-fl2' transform='translate(244 8) rotate(-30) scale(1.05)'/>" +
    "<use href='#sb-fl2' transform='translate(288 7) rotate(50) scale(.95)'/>" +
    "<use href='#sb-fl2' transform='translate(252 31) rotate(160) scale(.9)'/>" +
    "<use href='#sb-fl2' transform='translate(283 29) rotate(-120) scale(.85)'/>" +
    "<use href='#sb-fl2' transform='translate(232 20) rotate(90) scale(.8)'/>" +
    "<use href='#sb-fl2' transform='translate(264 4) rotate(105) scale(.9)'/>" +
    "<use href='#sb-fl2' transform='translate(298 14) rotate(-15) scale(.8)'/>" +
    "<use href='#sb-fl2' transform='translate(257 21) rotate(-85) scale(1.05)'/>" +
    "<use href='#sb-fl' transform='translate(258 14) rotate(20)'/>" +
    "<use href='#sb-fl' transform='translate(276 17) rotate(-35) scale(1.1)'/>" +
    "<use href='#sb-fl' transform='translate(266 29) rotate(75) scale(.95)'/>" +
    "<use href='#sb-fl' transform='translate(293 19) rotate(-70) scale(.9)'/>" +
    "<use href='#sb-fl' transform='translate(247 23) rotate(140) scale(.9)'/>" +
    "<use href='#sb-fl' transform='translate(283 12) rotate(115) scale(.85)'/>" +
    "<use href='#sb-half' transform='translate(238 12) rotate(-50) scale(.9)'/>" +
    "<use href='#sb-bud' transform='translate(238 35) rotate(-160)'/>" +
    "<use href='#sb-bud' transform='translate(297 33) rotate(150) scale(.9)'/>" +
    // fringe singles feathering the canopy's lower edge into the sky
    "<use href='#sb-fl2' transform='translate(250 40) rotate(25) scale(.7)'/>" +
    "<use href='#sb-fl2' transform='translate(276 38) rotate(-95) scale(.65)'/>" +
    "<use href='#sb-fl2' transform='translate(297 27) rotate(160) scale(.6)'/>" +
    "<use href='#sb-bud' transform='translate(262 41) rotate(-140) scale(.8)'/>" +
    "<use href='#sb-pt' fill='url(#sb-pg)' transform='translate(288 44) rotate(60) scale(.6)'/>" +
    // mid cluster riding the upper twig, half off the top crop
    "<ellipse cx='196' cy='11' rx='21' ry='13' fill='#ffb9d4' opacity='.28'/>" +
    "<use href='#sb-fl2' transform='translate(184 6) rotate(-20) scale(.85)'/>" +
    "<use href='#sb-fl2' transform='translate(208 5) rotate(40) scale(.9)'/>" +
    "<use href='#sb-fl2' transform='translate(188 18) rotate(120) scale(.8)'/>" +
    "<use href='#sb-fl' transform='translate(196 8) rotate(15)'/>" +
    "<use href='#sb-fl' transform='translate(205 15) rotate(-55) scale(.9)'/>" +
    "<use href='#sb-fl' transform='translate(189 13) rotate(100) scale(.85)'/>" +
    "<use href='#sb-half' transform='translate(211 10) rotate(60) scale(.8)'/>" +
    "<use href='#sb-bud' transform='translate(214 17) rotate(170) scale(.9)'/>" +
    "<use href='#sb-bud' transform='translate(180 2) rotate(-30) scale(.85)'/>" +
    // the drooping cluster — backlit fringe off the limb's belly
    "<ellipse cx='170' cy='56' rx='16' ry='11' fill='#ffb9d4' opacity='.28'/>" +
    "<use href='#sb-fl2' transform='translate(160 52) rotate(-10) scale(.8)'/>" +
    "<use href='#sb-fl2' transform='translate(180 58) rotate(140) scale(.75)'/>" +
    "<use href='#sb-fl' transform='translate(168 53) rotate(-45) scale(.9)'/>" +
    "<use href='#sb-fl' transform='translate(175 61) rotate(55) scale(.85)'/>" +
    "<use href='#sb-half' transform='translate(163 60) rotate(-120) scale(.8)'/>" +
    "<use href='#sb-bud' transform='translate(158 64) rotate(-170) scale(.9)'/>" +
    "<use href='#sb-bud' transform='translate(182 52) rotate(20) scale(.8)'/>" +
    // limb-tip cluster, the far reach of the tree
    "<ellipse cx='106' cy='58' rx='17' ry='11' fill='#ffb9d4' opacity='.3'/>" +
    "<use href='#sb-fl2' transform='translate(96 55) rotate(30) scale(.8)'/>" +
    "<use href='#sb-fl2' transform='translate(114 62) rotate(-100) scale(.75)'/>" +
    "<use href='#sb-fl' transform='translate(102 55) rotate(-25) scale(.95)'/>" +
    "<use href='#sb-fl' transform='translate(111 60) rotate(45) scale(.9)'/>" +
    "<use href='#sb-fl' transform='translate(103 64) rotate(175) scale(.8)'/>" +
    "<use href='#sb-bud' transform='translate(92 50) rotate(-60) scale(.9)'/>" +
    "<use href='#sb-bud' transform='translate(119 55) rotate(10) scale(.8)'/>" +
    "<use href='#sb-bud' transform='translate(117 67) rotate(170) scale(.85)'/>" +
    // upper-left twig cluster + singles tucked along the limb
    "<use href='#sb-fl2' transform='translate(130 26) rotate(70) scale(.7)'/>" +
    "<use href='#sb-fl' transform='translate(136 27) rotate(-15) scale(.85)'/>" +
    "<use href='#sb-half' transform='translate(128 31) rotate(-80) scale(.7)'/>" +
    "<use href='#sb-bud' transform='translate(144 31) rotate(45) scale(.8)'/>" +
    "<use href='#sb-fl' transform='translate(152 47) rotate(-20) scale(.7)'/>" +
    "<use href='#sb-bud' transform='translate(224 29) rotate(-25) scale(.7)'/>" +
    // the fork's buds and the fine-twig tips
    "<use href='#sb-bud' transform='translate(184 12) rotate(-105) scale(.85)'/>" +
    "<use href='#sb-half' transform='translate(178 14) rotate(40) scale(.7)'/>" +
    "<use href='#sb-bud' transform='translate(167 25) rotate(-160) scale(.7)'/>" +
    "<use href='#sb-bud' transform='translate(140 53) rotate(155) scale(.65)'/>" +
    // the twig that drapes over the kana signature
    "<use href='#sb-fl' transform='translate(247 45) rotate(-60) scale(.9)'/>" +
    "<use href='#sb-bud' transform='translate(243 53) rotate(-150) scale(.85)'/>" +
    "<use href='#sb-bud' transform='translate(253 38) rotate(30) scale(.75)'/>" +
    // painted petals letting go — the FX fall's static companions
    "<use href='#sb-pt' fill='url(#sb-pg)' transform='translate(226 50) rotate(70) scale(.75)'/>" +
    "<use href='#sb-pt' fill='url(#sb-pg2)' transform='translate(206 62) rotate(-30) scale(.6)'/>" +
    "<use href='#sb-pt' fill='url(#sb-pg)' transform='translate(236 66) rotate(130) scale(.55)'/>" +
    '</svg>'
)

/** Volumetric cumulus construction, shared by the static bank and the
 * exported FX puff: every cloud is built like the anime reference —
 * overlapping spheres each lit by a radial gradient (hot white toward
 * the sun top-left, cooling to blue-grey at the bottom-right rim), a
 * shaded belly slab with a crisp top edge under the lobe row, darker
 * ambient-occlusion creases where lobes overlap, and a faint ambient
 * shade beneath that floats the mass off the sky. Silhouettes stay
 * hard-edged; the internal modeling does the depth. sc-hi lights the
 * front sunlit lobes, sc-mid the rear/belly-side ones. */
const SAKURA_CLOUD_DEFS =
  '<defs>' +
  "<radialGradient id='sc-hi' cx='.38' cy='.28' r='.95'>" +
  "<stop offset='0' stop-color='#ffffff'/><stop offset='.5' stop-color='#f7fbff'/><stop offset='.82' stop-color='#e6effa'/><stop offset='1' stop-color='#cddcee'/>" +
  '</radialGradient>' +
  "<radialGradient id='sc-mid' cx='.4' cy='.28' r='.95'>" +
  "<stop offset='0' stop-color='#f0f6fc'/><stop offset='.6' stop-color='#d5e3f2'/><stop offset='1' stop-color='#a4bcdc'/>" +
  '</radialGradient>' +
  "<linearGradient id='sc-belly' x1='0' y1='0' x2='0' y2='1'>" +
  "<stop offset='0' stop-color='#b4c9e4'/><stop offset='1' stop-color='#86a0c4'/>" +
  '</linearGradient>' +
  '</defs>'

/** The painted cumulus bank left-of-branch: one big billowing mass and
 * a smaller companion, plus two thin high wisps. Sits where the fade
 * thins the art, reading as depth behind the name zone. */
const SAKURA_CLOUDS = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 86'>" +
    SAKURA_CLOUD_DEFS +
    // big mass — ambient shade, belly slab, back lobes, AO, lit lobes
    "<ellipse cx='62' cy='63' rx='46' ry='8' fill='#8fa9ca' opacity='.13'/>" +
    "<ellipse cx='61' cy='56' rx='46' ry='13' fill='url(#sc-belly)' opacity='.92'/>" +
    "<g fill='url(#sc-mid)'>" +
    "<circle cx='36' cy='46' r='14'/><circle cx='60' cy='38' r='18'/><circle cx='86' cy='44' r='13.5'/><circle cx='104' cy='52' r='9'/>" +
    '</g>' +
    "<g fill='#8ea7c8' opacity='.25'>" +
    "<ellipse cx='48' cy='44' rx='5' ry='3.4'/><ellipse cx='73' cy='42' rx='5.5' ry='3.6'/><ellipse cx='95' cy='50' rx='4' ry='2.6'/>" +
    '</g>' +
    "<g fill='url(#sc-hi)'>" +
    "<circle cx='38' cy='43' r='15'/><circle cx='62' cy='34' r='19'/><circle cx='88' cy='44' r='13'/><circle cx='105' cy='53' r='8.5'/>" +
    '</g>' +
    "<circle cx='58' cy='28' r='8' fill='#ffffff' opacity='.85'/>" +
    "<circle cx='36' cy='37' r='6' fill='#ffffff' opacity='.7'/>" +
    // smaller companion to the right
    "<ellipse cx='212' cy='67' rx='27' ry='5.5' fill='#8fa9ca' opacity='.12'/>" +
    "<ellipse cx='212' cy='62' rx='27' ry='9' fill='url(#sc-belly)' opacity='.9'/>" +
    "<g fill='url(#sc-mid)'>" +
    "<circle cx='196' cy='54' r='9.5'/><circle cx='214' cy='48' r='12'/><circle cx='232' cy='55' r='8.5'/>" +
    '</g>' +
    "<g fill='#8ea7c8' opacity='.25'>" +
    "<ellipse cx='205' cy='52' rx='3.4' ry='2.2'/><ellipse cx='223' cy='52' rx='3' ry='2'/>" +
    '</g>' +
    "<g fill='url(#sc-hi)'>" +
    "<circle cx='198' cy='52' r='9'/><circle cx='216' cy='46' r='11.5'/><circle cx='233' cy='54' r='8'/>" +
    '</g>' +
    "<circle cx='214' cy='41' r='4.5' fill='#ffffff' opacity='.8'/>" +
    // high thin wisps
    "<ellipse cx='150' cy='28' rx='18' ry='3' fill='#ffffff' opacity='.4'/>" +
    "<ellipse cx='262' cy='20' rx='12' ry='2.4' fill='#ffffff' opacity='.35'/>" +
    '</svg>'
)

/** One billowing cumulus puff, exported for the FX layer's two
 * slow-drifting live clouds (the base bank is static scenery; this is
 * the moving weather). Same sphere-lit construction as the bank so live
 * and painted clouds share one sky. */
export const SAKURA_CLOUD = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 46'>" +
    SAKURA_CLOUD_DEFS +
    "<ellipse cx='60' cy='37' rx='34' ry='6' fill='#8fa9ca' opacity='.13'/>" +
    "<ellipse cx='60' cy='32' rx='34' ry='10' fill='url(#sc-belly)' opacity='.92'/>" +
    "<g fill='url(#sc-mid)'>" +
    "<circle cx='40' cy='25' r='10.5'/><circle cx='60' cy='19' r='13.5'/><circle cx='80' cy='25' r='10'/>" +
    '</g>' +
    "<g fill='#8ea7c8' opacity='.25'>" +
    "<ellipse cx='50' cy='23' rx='3.6' ry='2.4'/><ellipse cx='70' cy='23' rx='3.4' ry='2.2'/>" +
    '</g>' +
    "<g fill='url(#sc-hi)'>" +
    "<circle cx='42' cy='23' r='11'/><circle cx='60' cy='17' r='14'/><circle cx='80' cy='24' r='10'/><circle cx='93' cy='29' r='6.5'/>" +
    '</g>' +
    "<circle cx='57' cy='12' r='5' fill='#ffffff' opacity='.85'/>" +
    '</svg>'
)

/** クリブル ("Cribble") hand-lettered as vertical brush calligraphy
 * (tategaki), stacked down the right side like a signature on a Japanese
 * art print — zero font dependency, crisp at every strip height. Each
 * glyph is round-capped organic strokes drawn twice: a wide translucent
 * navy keyline underneath (so the white reads against the palest sky)
 * and the white brush pass on top. Below the column: a vermillion hanko
 * seal with a white blossom mark, then a tiny engraved CRIBBLE caption
 * (textLength pins the advance, same crop-safety precedent as the
 * Ignition wordmark). Glyphs carry slight individual tilts — a printed
 * signature is never perfectly square. Placed height-proportionally
 * (auto 84%) so the full signature survives 68px rows and grows into
 * podium banners. */
const CRIBBLE_KANA = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 158'>" +
    '<defs>' +
    // ク — tick over a horizontal that turns and sweeps down-left
    "<path id='skb-ku' d='M14.5 4.5C16.5 6.5 18.5 8.5 20 10.5M12 14.5C17.5 14 22.5 13.4 27 12.8C28.2 12.6 28.9 13.4 28.3 14.4C26.5 18.5 22.9 22.5 17.8 25.6'/>" +
    // リ — short left stem, long right stem with a leftward finish
    "<path id='skb-ri' d='M14 42.5C13.7 46.5 13.4 50.5 13.6 54.2M22.5 41C22.2 46.5 21.9 52 21.4 56.6C21.1 59 19.6 60.8 17.2 61.6'/>" +
    // ブ — フ sweep with the two dakuten ticks
    "<path id='skb-bu' d='M11 80.5C16 79.9 20.8 79.3 25.2 78.8C26.4 78.7 27 79.6 26.4 80.6C24.4 86.4 19.6 91.8 13 95.6M27.5 74.2L29.3 76.2M30.8 73L32.6 75'/>" +
    // ル — left stem flicking left, right stem looping out right
    "<path id='skb-ru' d='M14.5 110C14.2 115 13.9 119.8 14 123.4C12.6 125.2 10.9 126.1 9.2 126.4M20.8 111C20.5 116 20.4 120.5 20.6 124.2C20.8 127.4 22.9 129.2 26.4 129.8'/>" +
    '</defs>' +
    "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<g stroke='#123a6b' stroke-width='6.4' opacity='.5'>" +
    "<use href='#skb-ku' transform='rotate(-2 18 16)'/><use href='#skb-ri' transform='rotate(1.5 18 50)'/><use href='#skb-bu' transform='rotate(-1 18 84)'/><use href='#skb-ru' transform='rotate(2 18 118)'/>" +
    '</g>' +
    "<g stroke='#ffffff' stroke-width='3'>" +
    "<use href='#skb-ku' transform='rotate(-2 18 16)'/><use href='#skb-ri' transform='rotate(1.5 18 50)'/><use href='#skb-bu' transform='rotate(-1 18 84)'/><use href='#skb-ru' transform='rotate(2 18 118)'/>" +
    '</g>' +
    '</g>' +
    // hanko seal — vermillion block, white blossom mark, red heart
    "<rect x='11.75' y='136' width='12.5' height='12.5' rx='2.2' fill='#d8382b'/>" +
    "<g fill='#ffffff'>" +
    "<ellipse cx='18' cy='140.15' rx='1.05' ry='1.75'/>" +
    "<ellipse cx='18' cy='140.15' rx='1.05' ry='1.75' transform='rotate(72 18 142.25)'/>" +
    "<ellipse cx='18' cy='140.15' rx='1.05' ry='1.75' transform='rotate(144 18 142.25)'/>" +
    "<ellipse cx='18' cy='140.15' rx='1.05' ry='1.75' transform='rotate(216 18 142.25)'/>" +
    "<ellipse cx='18' cy='140.15' rx='1.05' ry='1.75' transform='rotate(288 18 142.25)'/>" +
    '</g>' +
    "<circle cx='18' cy='142.25' r='.65' fill='#d8382b'/>" +
    "<text x='4.5' y='155.5' font-family='Arial,Helvetica,sans-serif' font-size='4.4' font-weight='700' textLength='27' lengthAdjust='spacingAndGlyphs' fill='#ffffff' fill-opacity='.85'>CRIBBLE</text>" +
    '</svg>'
)

/** Falling-petal faces, exported for the FX layer's 3D-tumbling petal
 * system. FRONT/BACK are the two sides of one sakura petal — notched
 * tip, center crease — the back a half-shade pinker so the card-flip
 * flashes light/dark on the breeze. FAR has the depth-of-field softness
 * baked in (feGaussianBlur inside the data-URI, painted once) — the
 * scene never animates a CSS filter. */
export const SAKURA_PETAL_FRONT = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spf' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#ffeef4'/><stop offset='.55' stop-color='#ffc9dc'/><stop offset='1' stop-color='#ff8fbc'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spf)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#e88fb4' stroke-width='.55' fill='none' opacity='.65'/>" +
    '</svg>'
)

export const SAKURA_PETAL_BACK = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spb' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#ffe3ee'/><stop offset='.55' stop-color='#ffb9d2'/><stop offset='1' stop-color='#f281b0'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spb)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#d8729c' stroke-width='.55' fill='none' opacity='.7'/>" +
    '</svg>'
)

export const SAKURA_PETAL_FAR = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 28 28'>" +
    "<defs><filter id='spb2' x='-40%' y='-40%' width='180%' height='180%'><feGaussianBlur stdDeviation='1.3'/></filter></defs>" +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='#ffc9dc' opacity='.85' filter='url(#spb2)'/>" +
    '</svg>'
)

/** Palette variants — the flurry mixes petals from different blossoms:
 * PALE is the near-white blush of a just-opened bloom, DEEP the
 * saturated pink of an older flower about to let go. Same geometry and
 * two-faced flip logic; only the gradients shift. */
export const SAKURA_PETAL_FRONT_PALE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spfp' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#ffffff'/><stop offset='.55' stop-color='#ffe4ee'/><stop offset='1' stop-color='#ffb9d2'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spfp)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#f0a8c4' stroke-width='.55' fill='none' opacity='.6'/>" +
    '</svg>'
)

export const SAKURA_PETAL_BACK_PALE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spbp' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#fff0f5'/><stop offset='.55' stop-color='#ffd0e0'/><stop offset='1' stop-color='#f79ec0'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spbp)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#e087ab' stroke-width='.55' fill='none' opacity='.65'/>" +
    '</svg>'
)

export const SAKURA_PETAL_FRONT_DEEP = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spfd' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#ffdbe8'/><stop offset='.5' stop-color='#ffaac9'/><stop offset='1' stop-color='#fb6ea4'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spfd)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#d7548b' stroke-width='.55' fill='none' opacity='.7'/>" +
    '</svg>'
)

export const SAKURA_PETAL_BACK_DEEP = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'>" +
    "<defs><radialGradient id='spbd' cx='.5' cy='.62' r='.75'>" +
    "<stop offset='0' stop-color='#ffc0d6'/><stop offset='.5' stop-color='#f98bb6'/><stop offset='1' stop-color='#ec5b96'/>" +
    '</radialGradient></defs>' +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='url(#spbd)'/>" +
    "<path d='M10 17.6C9.7 13.4 9.7 9.2 10 5.2' stroke='#c94a7f' stroke-width='.55' fill='none' opacity='.75'/>" +
    '</svg>'
)

export const SAKURA_PETAL_FAR_PALE = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 28 28'>" +
    "<defs><filter id='spb3' x='-40%' y='-40%' width='180%' height='180%'><feGaussianBlur stdDeviation='1.3'/></filter></defs>" +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='#ffe3ee' opacity='.85' filter='url(#spb3)'/>" +
    '</svg>'
)

export const SAKURA_PETAL_FAR_DEEP = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 28 28'>" +
    "<defs><filter id='spb4' x='-40%' y='-40%' width='180%' height='180%'><feGaussianBlur stdDeviation='1.3'/></filter></defs>" +
    "<path d='M10 18.4C6.6 17.6 4.2 15 3.6 11.8C3.1 9 4.6 6.4 6.8 4.9C8.2 3.9 9.4 3.4 10 4.6C10.6 3.4 11.8 3.9 13.2 4.9C15.4 6.4 16.9 9 16.4 11.8C15.8 15 13.4 17.6 10 18.4Z' fill='#ff9ec2' opacity='.85' filter='url(#spb4)'/>" +
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

/** The booster's tail peeking in from the right edge, drawn as one bold
 * read at strip scale: an off-white swept aft fin + body block sliding
 * off-screen, carrying a dark letter-spaced SPACEXAI wordmark (textLength
 * pins the advance, so the edge crop always reads `SPACEXA` plus a sliver
 * of `I` regardless of system sans metrics) and a tiny geometric X
 * logomark; a charcoal engine-bay skirt with panel lines and rivet dots;
 * a far-side grid-fin stub peeking over the crown; and one bell nozzle in
 * profile — titanium-bronze walls, a hot rim highlight at the exit lip,
 * and a dark open interior the FX throat glow fires inside. Nozzle exit
 * plane sits at (92,35) of the 130×70 box — at the catalog placement
 * (130px wide, right 0) that lands the exit exactly 38px from the right
 * edge, vertically centered; the FX layer pins its plume stack, mach
 * diamonds, throat glow and the 14s re-light flash to the same point. */
const IGNITION_BOOSTER = svg(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 130 70'>" +
    "<defs>" +
    "<linearGradient id='ignb-body' x1='0' y1='4' x2='0' y2='62' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='#f4f5f7'/><stop offset='.38' stop-color='#dde0e6'/><stop offset='1' stop-color='#bfc4ce'/></linearGradient>" +
    "<linearGradient id='ignb-skirt' x1='0' y1='34' x2='0' y2='62' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='#2b2b32'/><stop offset='1' stop-color='#141419'/></linearGradient>" +
    "<linearGradient id='ignb-bell' x1='92' y1='35' x2='111' y2='35' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='#f2c184'/><stop offset='.2' stop-color='#d99c5b'/><stop offset='.5' stop-color='#a06a3c'/><stop offset='.8' stop-color='#6e452a'/><stop offset='1' stop-color='#57351f'/></linearGradient>" +
    "<linearGradient id='ignb-in' x1='93' y1='35' x2='107' y2='35' gradientUnits='userSpaceOnUse'><stop offset='0' stop-color='#150c06'/><stop offset='1' stop-color='#050303'/></linearGradient>" +
    '</defs>' +
    // far-side grid-fin stub peeking over the body's crown
    "<rect x='110' y='0' width='11' height='9' rx='1' fill='#26262c'/>" +
    "<g stroke='#4a4a55' stroke-width='.7'><path d='M113.5 0V9M117 0V9M110 2.2h11'/></g>" +
    // aft fin + body block, hard-cropped by the right edge
    "<path d='M134 62L134 4.8L86 4.8Q83 14 100 26L100 62Z' fill='url(#ignb-body)'/>" +
    "<path d='M86 4.8Q83 14 100 26' fill='none' stroke='#a9aeb9' stroke-width='.8' stroke-opacity='.7'/>" +
    "<path d='M88 6.4H129' stroke='#ffffff' stroke-width='.8' stroke-opacity='.35'/>" +
    // textLength pins the advance so the crop survives any system sans
    "<text x='89.5' y='15.5' font-family='Arial,Helvetica,sans-serif' font-size='7.5' font-weight='700' textLength='41' lengthAdjust='spacingAndGlyphs' fill='#1e2129'>SPACEXAI</text>" +
    "<path d='M111.8 27.3L116.2 31.7M116.2 27.3L111.8 31.7' stroke='#1e2129' stroke-width='1.3'/>" +
    // engine-bay skirt: panel seams, rivet rows, a warm rim from the plume
    "<rect x='100' y='34' width='34' height='28' rx='1.5' fill='url(#ignb-skirt)'/>" +
    "<path d='M100 34H134' stroke='#0c0c10' stroke-width='1'/>" +
    "<g stroke='#3b3b45' stroke-width='.8'><path d='M112 36.5V60M122 36.5V60' stroke-opacity='.8'/><path d='M101 48H133' stroke-opacity='.55'/></g>" +
    "<g fill='#484852'><circle cx='103.5' cy='37.2' r='.7'/><circle cx='117' cy='37.2' r='.7'/><circle cx='127' cy='37.2' r='.7'/><circle cx='103.5' cy='58.8' r='.7'/><circle cx='107.5' cy='58.8' r='.7'/><circle cx='117' cy='58.8' r='.7'/><circle cx='127' cy='58.8' r='.7'/></g>" +
    "<path d='M100 35.5V60.5' stroke='#ff8a50' stroke-width='1' stroke-opacity='.3'/>" +
    // bell nozzle — exit plane x=92, centered on y=35; the interior stays
    // dark and open, the FX throat glow owns the light inside
    "<path d='M92 20C96.5 21.8 101 25 106 28.5L111 28.5L111 41.5L106 41.5C101 45 96.5 48.2 92 50Z' fill='url(#ignb-bell)'/>" +
    "<path d='M93.4 21.8C97.5 23.8 102 27.2 106.5 30.6L106.5 39.4C102 42.8 97.5 46.2 93.4 48.2Z' fill='url(#ignb-in)'/>" +
    "<path d='M94 49.2C97.5 47.6 101 44.8 105 41.8' fill='none' stroke='#2a1408' stroke-width='1.1' stroke-opacity='.45'/>" +
    "<path d='M94.5 21.6C98 23 101.5 25.6 105 28' fill='none' stroke='#ffe6c8' stroke-width='.8' stroke-opacity='.28'/>" +
    "<path d='M92 20C94.5 20.7 96.8 21.9 98.6 23.2M92 50C94.5 49.3 96.8 48.1 98.6 46.8' fill='none' stroke='#ffd8a8' stroke-width='1.5' stroke-linecap='round' stroke-opacity='.9'/>" +
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
        // the tree over the signature (blossoms overlap the top glyph),
        // both over a daylight sky with the sun burning behind the canopy
        `${SAKURA_BRANCH} right -8px top -4px / 300px 110px no-repeat`,
        `${CRIBBLE_KANA} right 16px center / auto 84% no-repeat`,
        `${SAKURA_CLOUDS} left 14% top 4% / 300px 81px no-repeat`,
        // sun bloom + flare ring behind the canopy (fixed-px core so it
        // reads as a disk at every strip height, not a smear)
        'radial-gradient(circle at 84% 16%, rgb(255 253 242 / 0.98) 0 9px, rgb(255 247 212 / 0.55) 15px, rgb(255 238 190 / 0.2) 26px, transparent 42px)',
        'radial-gradient(circle at 84% 16%, transparent 28px, rgb(255 250 224 / 0.22) 34px, transparent 46px)',
        'radial-gradient(120% 160% at 84% 14%, rgb(255 244 210 / 0.26), transparent 55%)',
        // anime midday: luminous cerulean overhead easing through bright
        // azure to a warm pale horizon (the navy kana keyline keeps the
        // signature legible against the brightest band)
        'linear-gradient(180deg, rgb(43 116 208) 0%, rgb(70 142 220) 30%, rgb(116 176 234) 55%, rgb(168 210 244) 76%, rgb(232 243 252) 100%)'
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
        // nozzle exit plane: viewBox (92,35) at this placement lands 38px
        // from the right edge at 50% height — every flame-origin gradient
        // below centers on the same point, so the sky burns from the bell
        `${IGNITION_BOOSTER} right 0 center / 130px 70px no-repeat`,
        // the pad lights up under the plume — warm wash sits OVER the checker
        'radial-gradient(150px 48px at calc(100% - 56px) 100%, rgb(255 122 60 / 0.2), transparent 72%)',
        `${IGNITION_CHECKER} right 0 bottom 0 / 168px 16px no-repeat`,
        'repeating-linear-gradient(45deg, rgb(255 255 255 / 0.016) 0 2px, transparent 2px 6px)',
        // ember-orange fire zone centered on the nozzle exit…
        'radial-gradient(110px 70px at calc(100% - 38px) 50%, rgb(255 106 40 / 0.4), rgb(215 48 90 / 0.14) 58%, transparent 78%)',
        // …bridged by magenta up into a violet haze in the upper right
        'radial-gradient(210px 120px at calc(100% - 66px) 28%, rgb(236 72 153 / 0.15), transparent 70%)',
        'radial-gradient(65% 120% at 88% 0%, rgb(139 92 246 / 0.16), transparent 62%)',
        'linear-gradient(90deg, transparent 52%, rgb(255 80 40 / 0.06))',
        'linear-gradient(180deg, rgb(20 9 26), rgb(9 4 13))'
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
