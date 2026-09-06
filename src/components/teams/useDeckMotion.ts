'use client'

// Command-deck motion. GSAP owns the one-shot boot (rule draw, section
// rise, roster stagger, score ticker) and the dossier swap when a
// different roster row is lit. anime.js owns the live roster-lamp
// pulse — a surface loop that should keep running after the boot timeline
// has released. All honor OS reduced-motion and Cribble's data-motion kill
// switch; the lamp also watches both live so flipping the toggle mid-session
// stops/starts it. Every selector — matchMedia included — is scoped to the
// deck root.

import { useEffect, useRef, useState, type RefObject } from 'react'
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

// Live mirror of motionReduced(): re-reads when the in-app data-motion
// attribute flips or the OS query changes, so surface loops that outlive
// the boot can react without a remount.
function useReducedMotionFlag(): boolean {
  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => {
    const sync = () => setReduced(motionReduced())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    })
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    mq.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', sync)
    }
  }, [])
  return reduced
}

export function useDeckMotion(
  root: RefObject<HTMLElement | null>,
  opts: {
    score: number
    recruiting: boolean
    selectedKey: number | null
    /** The lit rail sector — a change remounts the rail (keyed in JSX)
     *  and slides the new panel in. */
    sector: string
  }
) {
  // The boot already lifts the dossier and the rail in with their
  // compartments; only later changes get the swap.
  const dossierMounted = useRef(false)
  const railMounted = useRef(false)
  // The boot runs once, but the score may refresh underneath it — the
  // ticker reads the latest value so it never lands on a stale number.
  const scoreRef = useRef(opts.score)
  scoreRef.current = opts.score
  const reduced = useReducedMotionFlag()

  useGSAP(
    () => {
      const el = root.current
      if (!el) return

      const mm = gsap.matchMedia(el)
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

          // The shell's solid --deck-line backdrop (the hairline-grid trick)
          // would read as a flat grey slab while its cells are still hidden —
          // fade the whole slab in under the compartments.
          const shell = el.querySelector<HTMLElement>('.deck-shell')
          if (shell) {
            gsap.set(shell, { autoAlpha: 0 })
            tl.to(
              shell,
              {
                autoAlpha: 1,
                duration: 0.3,
                ease: 'power1.out',
                clearProps: 'opacity,visibility'
              },
              0
            )
          }

          const boots = gsap.utils.toArray<HTMLElement>('.deck-boot', el)
          const rules = gsap.utils.toArray<HTMLElement>('.deck-rule', el)
          if (boots.length > 0) gsap.set(boots, { autoAlpha: 0, y: 8 })
          if (rules.length > 0) gsap.set(rules, { scaleX: 0 })

          if (rules.length > 0) {
            tl.to(rules, { scaleX: 1, duration: 0.5, stagger: 0.05 }, 0)
          }
          if (boots.length > 0) {
            tl.to(
              boots,
              {
                autoAlpha: 1,
                y: 0,
                stagger: 0.055,
                clearProps: 'transform,opacity,visibility'
              },
              0.06
            )
          }

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
          if (scoreEl && scoreRef.current > 0) {
            const obj = { n: 0 }
            scoreEl.textContent = '0'
            tl.to(
              obj,
              {
                // Function-based so the end target resolves when the tween
                // first renders, not when the timeline was built.
                n: () => scoreRef.current,
                duration: 0.68,
                ease: 'power2.out',
                onUpdate: () => {
                  scoreEl.textContent = formatNumber(Math.round(obj.n))
                },
                onComplete: () => {
                  scoreEl.textContent = formatNumber(scoreRef.current)
                }
              },
              0.12
            )
          }
        }
      )

      return () => {
        mm.revert()
        // A revert mid-tick would otherwise strand a partial numeral.
        const scoreEl = el.querySelector<HTMLElement>('[data-deck-score]')
        if (scoreEl) scoreEl.textContent = formatNumber(scoreRef.current)
      }
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
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.26,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility'
        }
      )
    },
    { scope: root, dependencies: [opts.selectedKey] }
  )

  // Sector swap: the rail is keyed by sector, so a tab change mounts a
  // fresh panel — rise it in from the tab strip above, and re-draw the
  // share fills inside it so the dossier's bar reads as live telemetry.
  useGSAP(
    () => {
      if (!railMounted.current) {
        railMounted.current = true
        return
      }
      if (motionReduced()) return
      const rail = root.current?.querySelector<HTMLElement>('[data-deck-rail]')
      if (!rail) return
      const tl = gsap.timeline()
      tl.fromTo(
        rail,
        { autoAlpha: 0, y: -6 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.24,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility'
        }
      )
      const fills = gsap.utils.toArray<HTMLElement>('.deck-share-fill', rail)
      if (fills.length > 0) {
        tl.from(
          fills,
          { scaleX: 0, duration: 0.4, ease: 'power3.out', transformOrigin: 'left center' },
          0.05
        )
      }
    },
    { scope: root, dependencies: [opts.sector] }
  )

  // Lamp pulse re-arms off the live flag so the in-app toggle can stop or
  // start it without a remount.
  useGSAP(
    () => {
      if (reduced || !opts.recruiting) return
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
    { scope: root, dependencies: [opts.recruiting, reduced] }
  )
}
