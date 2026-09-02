'use client'

// Command-deck motion. GSAP owns the one-shot boot (rule draw, section
// rise, roster stagger, score ticker) and the dossier swap when a
// different roster row is lit. anime.js owns the live roster-lamp
// pulse — a surface loop that should keep running after the boot timeline
// has released. All honor OS reduced-motion and Cribble's data-motion kill
// switch. Selectors are scoped to the deck root.

import { useRef, type RefObject } from 'react'
import { animate } from 'animejs'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { formatNumber } from '@/components/dashboard-v2/format'
import { prefersReducedMotion } from '@/lib/motion'

gsap.registerPlugin(useGSAP)

function motionReduced(): boolean {
  if (typeof document === 'undefined') return true
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}

export function useDeckMotion(
  root: RefObject<HTMLElement | null>,
  opts: { score: number; recruiting: boolean; selectedKey: number | null }
) {
  // The boot already lifts the dossier in with its compartment; only
  // later selection changes get the swap.
  const dossierMounted = useRef(false)

  useGSAP(
    () => {
      const el = root.current
      if (!el) return

      const mm = gsap.matchMedia()
      mm.add(
        {
          reduceMotion: '(prefers-reduced-motion: reduce)',
          allowMotion: '(prefers-reduced-motion: no-preference)'
        },
        (context) => {
          const reduce =
            Boolean(context.conditions?.reduceMotion) ||
            document.documentElement.dataset.motion === 'reduced'
          if (reduce) return

          const tl = gsap.timeline({
            defaults: { ease: 'power2.out', duration: 0.42 }
          })

          gsap.set('.deck-boot', { autoAlpha: 0, y: 8 })
          gsap.set('.deck-rule', { scaleX: 0 })

          tl.to('.deck-rule', { scaleX: 1, duration: 0.5, stagger: 0.05 }, 0)
          tl.to(
            '.deck-boot',
            {
              autoAlpha: 1,
              y: 0,
              stagger: 0.055,
              clearProps: 'transform'
            },
            0.06
          )

          const rows = gsap.utils.toArray<HTMLElement>('.deck-pilot', el)
          if (rows.length > 0) {
            tl.from(
              rows,
              {
                autoAlpha: 0,
                y: 6,
                stagger: 0.04,
                duration: 0.3,
                clearProps: 'transform,opacity,visibility'
              },
              0.22
            )
          }

          const fills = gsap.utils.toArray<HTMLElement>('.deck-share-fill', el)
          if (fills.length > 0) {
            tl.from(
              fills,
              {
                scaleX: 0,
                duration: 0.46,
                stagger: 0.035,
                ease: 'power3.out'
              },
              0.34
            )
          }

          const scoreEl = el.querySelector<HTMLElement>('[data-deck-score]')
          if (scoreEl && opts.score > 0) {
            const obj = { n: 0 }
            scoreEl.textContent = '0'
            tl.to(
              obj,
              {
                n: opts.score,
                duration: 0.68,
                ease: 'power2.out',
                onUpdate: () => {
                  scoreEl.textContent = formatNumber(Math.round(obj.n))
                }
              },
              0.12
            )
          }
        }
      )

      return () => mm.revert()
    },
    { scope: root }
  )

  // Dossier swap: the readout re-keys on the lit row, so a fresh node
  // mounts — slide it in from the list's edge like a card being pulled.
  useGSAP(
    () => {
      if (!dossierMounted.current) {
        dossierMounted.current = true
        return
      }
      if (motionReduced()) return
      const body = root.current?.querySelector<HTMLElement>('.deck-dossier-body')
      if (!body) return
      gsap.fromTo(
        body,
        { autoAlpha: 0, x: -10 },
        { autoAlpha: 1, x: 0, duration: 0.26, ease: 'power3.out', clearProps: 'transform' }
      )
    },
    { scope: root, dependencies: [opts.selectedKey] }
  )

  useGSAP(
    () => {
      if (motionReduced() || !opts.recruiting) return
      const lamp = root.current?.querySelector('.deck-lamp-live')
      if (!lamp) return
      const pulse = animate(lamp, {
        opacity: [1, 0.32],
        duration: 1400,
        alternate: true,
        loop: true,
        ease: 'inOutSine'
      })
      return () => pulse.revert()
    },
    { scope: root, dependencies: [opts.recruiting] }
  )
}
