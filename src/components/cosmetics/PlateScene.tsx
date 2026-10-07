// Season 01 scene plates: painted art cut into layers (backdrop, subject
// sprite, small FX pieces) under /public/plates/season-01/<scene>/, composed
// and animated by PlateScene.module.css. Rendered by PlateLayer inside its
// fade/mask wrapper, so reduced motion freezes these with every other plate.
// Inline left/top are % of the scene or of a subject's rig; negative delays
// de-sync loops so a page of rows never pulses in unison.

import type { CSSProperties } from 'react'
import type { PlateSceneId } from '@/lib/cosmetics/plates'
import s from './PlateScene.module.css'

const ASSETS = '/plates/season-01'

const at = (left: number, top: number, delay = 0): CSSProperties => ({
  left: `${left}%`,
  top: `${top}%`,
  animationDelay: `${delay}s`
})

function Art({ src, className }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${ASSETS}/${src}`} alt="" decoding="async" loading="lazy" draggable={false} className={className} />
}

export function PlateScene({ scene }: { scene: PlateSceneId }) {
  return <div className={s.plate}>{sceneBody(scene)}</div>
}

function sceneBody(scene: PlateSceneId) {
  switch (scene) {
    case 'always-open':
      return <AlwaysOpen />
    case 'noodle-dragon':
      return <NoodleDragon />
    case 'touch-grass':
      return <TouchGrass />
    case 'peer-review':
      return <PeerReview />
    default: {
      const exhaustive: never = scene
      return exhaustive
    }
  }
}

/* ---------------------------------------------------------------- always open */

const pixelSvg = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' shape-rendering='crispEdges'>${body}</svg>`
  )}")`

/** Seeded single-pixel snow tile, so every row draws the same flakes. */
function snowTile(w: number, h: number, count: number, fill: string, seed: number) {
  let state = seed
  const next = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
  let body = ''
  for (let i = 0; i < count; i++) {
    body += `<rect x='${Math.floor(next() * w)}' y='${Math.floor(next() * h)}' width='1' height='1' fill='${fill}'/>`
  }
  return pixelSvg(w, h, body)
}

const AO_VARS = {
  '--snow-far': snowTile(64, 64, 9, '#cfc8f4', 7),
  '--snow-near': snowTile(96, 64, 6, '#fffaff', 19),
  '--spark': pixelSvg(3, 3, "<rect x='1' y='0' width='1' height='3' fill='#fff6ec'/><rect x='0' y='1' width='3' height='1' fill='#fff6ec'/>")
} as CSSProperties

const AO_SPARKS: [number, number, number][] = [
  [34, 8, 0],
  [52, 22, -1.3],
  [63, 6, -2.2],
  [71, 30, -0.6],
  [88, 12, -3.1],
  [96, 26, -1.8]
]

function AlwaysOpen() {
  return (
    <div className={`${s.scene} ${s.ao}`} style={AO_VARS}>
      <div className={`${s.sky} ${s.px}`} />
      {AO_SPARKS.map(([left, top, delay]) => (
        <div key={`${left}-${top}`} className={`${s.twk} ${s.px}`} style={at(left, top, delay)} />
      ))}
      <div className={`${s.dio} ${s.rig}`}>
        <Art src="always-open/diorama.webp" className={s.px} />
        <Art src="always-open/wires.webp" className={`${s.px} ${s.wires}`} />
        <div className={s.win} />
        <div className={s.signglow} />
        <div className={s.neon} />
      </div>
      <div className={`${s.snow} ${s.far} ${s.px}`} />
      <div className={`${s.snow} ${s.near} ${s.px}`} />
    </div>
  )
}

/* ---------------------------------------------------------------- noodle dragon */

const ND_STARS: [number, number, number][] = [
  [30, 18, 0],
  [38, 56, -0.9],
  [66, 8, -1.7],
  [76, 52, -0.4],
  [97, 14, -2.2],
  [22, 40, -1.3]
]

function NoodleDragon() {
  return (
    <div className={`${s.scene} ${s.nd}`}>
      <div className={s.sky} />
      <div className={s.moon}>
        <Art src="noodle-dragon/moon.webp" />
      </div>
      {ND_STARS.map(([left, top, delay]) => (
        <div key={`${left}-${top}`} className={s.star} style={at(left, top, delay)}>
          <Art src="noodle-dragon/star.webp" />
        </div>
      ))}
      <div className={s.body}>
        <i />
      </div>
      <div className={`${s.head} ${s.rig}`}>
        <Art src="noodle-dragon/head.webp" />
        <div className={`${s.eye} ${s.eyeA}`}>
          <i />
        </div>
        <div className={`${s.eye} ${s.eyeB}`}>
          <i />
        </div>
        <div className={s.fire}>
          <Art src="noodle-dragon/fire.webp" />
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- touch grass */

const TG_MOTES: [number, number, number][] = [
  [40, 70, 0],
  [55, 82, -3.4],
  [63, 60, -6.1],
  [72, 88, -1.7],
  [86, 66, -8.2],
  [94, 80, -4.9]
]

function TouchGrass() {
  return (
    <div className={`${s.scene} ${s.tg}`}>
      <div className={s.bg} />
      {TG_MOTES.map(([left, top, delay]) => (
        <div key={`${left}-${top}`} className={s.mote} style={at(left, top, delay)} />
      ))}
      <div className={`${s.tv} ${s.rig}`}>
        <Art src="touch-grass/tv.webp" />
        <div className={s.screen}>
          <div className={s.phosphor} />
          <div className={s.face}>
            <i className={`${s.eye} ${s.eyeL}`} />
            <i className={`${s.eye} ${s.eyeR}`} />
            <i className={s.mouth} />
          </div>
          <div className={s.scan} />
          <div className={s.roll} />
        </div>
        <div className={s.bfly}>
          <i />
          <i />
          <b />
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- peer review */

function PeerReview() {
  return (
    <div className={`${s.scene} ${s.pr}`}>
      <div className={s.sky} />
      <div className={`${s.frogs} ${s.rig}`}>
        <Art src="peer-review/frogs.webp" />
        <div className={s.lens} style={at(42.7, 29.6)}>
          <i />
        </div>
        <div className={s.lens} style={at(51.5, 23)}>
          <i style={{ animationDelay: '-0.1s' }} />
        </div>
        <div className={s.fly}>
          <i />
          <b />
          <i />
        </div>
      </div>
    </div>
  )
}
