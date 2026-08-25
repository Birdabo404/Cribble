// GSAP glue for the welcome flow. Every welcome component that animates
// imports from here, so the module's side effect registers the plugins and
// the site's signature ease exactly once — client-side only, since 'use
// client' modules still evaluate during SSR.
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { CustomEase } from 'gsap/CustomEase'
import { prefersReducedMotion } from '@/lib/motion'

/** GSAP ease name mirroring the site-wide cubic-bezier(0.22, 1, 0.36, 1),
 *  so GSAP motion and the remaining CSS motion read as one system. */
export const CRIBBLE_EASE = 'cribble'

if (typeof window !== 'undefined') {
  gsap.registerPlugin(useGSAP, CustomEase)
  CustomEase.create(CRIBBLE_EASE, '0.22,1,0.36,1')
}

/** True when motion should be instant states with zero loops. Honors BOTH
 *  the OS media query and Cribble's in-app Appearance kill switch
 *  (html[data-motion='reduced']). GSAP writes inline styles that the CSS
 *  kill-switch rules can't touch, so every welcome tween and loop must
 *  consult this guard itself. */
export function welcomeMotionReduced(): boolean {
  if (typeof document === 'undefined') return true
  return (
    prefersReducedMotion() ||
    document.documentElement.dataset.motion === 'reduced'
  )
}
