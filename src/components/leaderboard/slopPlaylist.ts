// CH 99 program guide — genuinely public-domain / Creative Commons
// cartoons hotlinked straight from archive.org. Every entry was vetted
// at curation time: the license is PD or CC (no copyright uploads from
// the animationandcartoons grab-bag), and the file is the h.264 MP4
// derivative (avc1 — Safari can't decode .ogv or MPEG-4 Part 2) served
// with 206 range support. The stable download/<id>/<file> URL 302s to
// whichever storage node holds the item (*.us.archive.org or
// *.ca.archive.org), so only the stable form is stored here (the node
// hosts are cleared in the middleware's media-src).
//
// Provenance, per entry:
//   Sintel / BigBuckBunny_328 — Blender open movies, CC-BY 3.0.
//   superman_1941 / superman_the_mechanical_monsters — Fleischer Superman
//     eps. 1-2 (1941), copyright not renewed.
//   bb_snow_white        — Betty Boop "Snow-White" (1933), copyright not renewed.
//   FLIP_FROG-FIDDLESTICKS — Ub Iwerks' Flip the Frog debut (1930), not renewed.
//   woody_woodpecker_pantry_panic — "Pantry Panic" (1941), one of the
//     Lantz shorts whose copyright famously lapsed.
//   (ElephantsDream was cut at curation: CC-BY and h.264, but its item
//   lives on a *.ca.archive.org node that intermittently refuses WebKit.)

export type SlopClip = {
  /** archive.org item identifier (https://archive.org/details/<id>). */
  id: string
  title: string
  year: number
  /** Direct h.264 MP4 derivative URL, verified 200/206 video/mp4. */
  src: string
}

export const SLOP_PLAYLIST: readonly SlopClip[] = [
  {
    id: 'superman_1941',
    title: 'Superman: The Mad Scientist',
    year: 1941,
    src: 'https://archive.org/download/superman_1941/superman_1941_512kb.mp4'
  },
  {
    id: 'superman_the_mechanical_monsters',
    title: 'Superman: The Mechanical Monsters',
    year: 1941,
    src: 'https://archive.org/download/superman_the_mechanical_monsters/superman_the_mechanical_monsters_512kb.mp4'
  },
  {
    id: 'bb_snow_white',
    title: 'Betty Boop: Snow-White',
    year: 1933,
    src: 'https://archive.org/download/bb_snow_white/bb_snow_white_512kb.mp4'
  },
  {
    id: 'FLIP_FROG-FIDDLESTICKS',
    title: 'Flip the Frog: Fiddlesticks',
    year: 1930,
    src: 'https://archive.org/download/FLIP_FROG-FIDDLESTICKS/FLIP_FROG-FIDDLESTICKS_DVD_512kb.mp4'
  },
  {
    id: 'woody_woodpecker_pantry_panic',
    title: 'Woody Woodpecker: Pantry Panic',
    year: 1941,
    src: 'https://archive.org/download/woody_woodpecker_pantry_panic/woody_woodpecker_pantry_panic_512kb.mp4'
  },
  {
    id: 'BigBuckBunny_328',
    title: 'Big Buck Bunny',
    year: 2008,
    src: 'https://archive.org/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4'
  },
  {
    id: 'Sintel',
    title: 'Sintel',
    year: 2010,
    src: 'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4'
  },
  {
    id: 'Tears-of-Steel',
    title: 'Tears of Steel',
    year: 2012,
    src: 'https://archive.org/download/Tears-of-Steel/tears_of_steel_1080p.mp4'
  },
  {
    id: 'Caminandes1LlamaDrama',
    title: 'Caminandes 1: Llama Drama',
    year: 2013,
    src: 'https://archive.org/download/Caminandes1LlamaDrama/01_llama_drama_1080p.mp4'
  },
  {
    id: 'CaminandesLlamigos',
    title: 'Caminandes 3: Llamigos',
    year: 2016,
    src: 'https://archive.org/download/CaminandesLlamigos/Caminandes_%20Llamigos-1080p.mp4'
  },
  {
    id: 'CosmosLaundromatFirstCycle',
    title: 'Cosmos Laundromat: First Cycle',
    year: 2015,
    src: 'https://archive.org/download/CosmosLaundromatFirstCycle/Cosmos%20Laundromat%20-%20First%20Cycle%20%281080p%29.mp4'
  },
  {
    id: 'GlassHalf1080p',
    title: 'Glass Half',
    year: 2015,
    src: 'https://archive.org/download/GlassHalf1080p/Glass%20Half-1080p.mp4'
  },
  {
    id: 'springopenmovie',
    title: 'Spring',
    year: 2019,
    src: 'https://archive.org/download/springopenmovie/springopenmovie.mp4'
  },
  {
    id: 'hero_20260106',
    title: 'Hero',
    year: 2018,
    src: 'https://archive.org/download/hero_20260106/hero.mp4'
  },
  {
    id: 'sprite-fright-2021',
    title: 'Sprite Fright',
    year: 2021,
    src: 'https://archive.org/download/sprite-fright-2021/Sprite%20Fright%20%282021%29.mp4'
  },
  // CC-BY-ND (no derivatives).
  {
    id: 'agent327operationbarbershop',
    title: 'Agent 327: Operation Barbershop',
    year: 2017,
    src: 'https://archive.org/download/agent327operationbarbershop/agent327-1080.mp4'
  },
  // CC-BY-ND (no derivatives).
  {
    id: 'charge_202601',
    title: 'Charge',
    year: 2022,
    src: 'https://archive.org/download/charge_202601/Charge.mp4'
  },
  // CC-BY-ND (no derivatives).
  {
    id: 'coffee-run',
    title: 'Coffee Run',
    year: 2020,
    src: 'https://archive.org/download/coffee-run/Coffee%20Run.mp4'
  },
  {
    id: 'SupermanBillionDollarLimited1942',
    title: 'Superman: Billion Dollar Limited',
    year: 1942,
    src: 'https://archive.org/download/SupermanBillionDollarLimited1942/Superman%20-%20Billion%20Dollar%20Limited%20%281942%29.mp4'
  },
  {
    id: 'UbIwerksCartoonComicolorDonQuixote1934OldFreeCartoonsPublicDomain',
    title: 'Don Quixote (ComiColor)',
    year: 1934,
    src: 'https://archive.org/download/UbIwerksCartoonComicolorDonQuixote1934OldFreeCartoonsPublicDomain/Ub%20Iwerks%20cartoon%20%20%20Comicolor%20%20%20Don%20Quixote%201934%20old%20free%20cartoons%20public%20domain.mp4'
  },
  {
    id: 'BalloonLand_450',
    title: 'Balloon Land (ComiColor)',
    year: 1935,
    src: 'https://archive.org/download/BalloonLand_450/BalloonLand.mp4'
  }
]

/** Fisher–Yates shuffle into a fresh array (input stays untouched). */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
