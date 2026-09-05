'use client'

// Persistent chrome for all authenticated pages, mounted once by the
// (app) route-group layout. Because the layout survives client-side
// navigation, the nav and backdrop never remount between pages — route
// changes only swap the content inside .app-nav-inset.
//
// Exception: profile routes (/profile, /u/*) drop the animated starfield
// + glow — the ~70 looping twinkle animations made the profile feel
// heavy — and get no backdrop at all: the UNIT RECORD is a sheet on a
// drafting board, so the page area around it is painted as the board
// (.pf-page, globals.css) in both themes. That paint goes on a wrapper
// INSIDE .app-nav-inset's padding, never on the inset itself: the fixed
// top bar and the rail are translucent glass over the canvas, and their
// zinc-100 chrome would sit on the board if it ran under them.

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { BillboardTicker } from '@/components/billboard/BillboardTicker'
import { AmbientGlow } from '@/components/dashboard-v3/AmbientGlow'
import { AsteroidShower } from '@/components/dashboard-v3/AsteroidShower'
import { GlassTilt } from '@/components/dashboard-v3/GlassTilt'
import { BackgroundMusicProvider } from '@/components/music/BackgroundMusicProvider'
import { NowPlayingTicker } from '@/components/music/NowPlayingTicker'
import { SfxProvider } from '@/components/sfx/SfxProvider'
import { AppNav } from './AppNav'
import { NavPrefsProvider } from './NavPrefsContext'
import { NavStatusProvider } from './NavStatusContext'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const profileRoute = pathname === '/profile' || pathname.startsWith('/u/')
  // Light-mode AmbientGlow reads as a blurry orange haze on the data-dense
  // dashboard and leaderboard pages, so those routes drop it (dark mode
  // already hides the layer via CSS).
  const noGlowRoute =
    pathname === '/leaderboard' ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/')

  return (
    <NavPrefsProvider>
      <NavStatusProvider>
        {/* mounted here (not per page) so route changes never remount the
            Audio element — playback carries across client navigations */}
        <BackgroundMusicProvider>
          {/* document-level pointerdown SFX; wraps the whole shell so
              every useSfx() consumer shares one engine */}
          <SfxProvider>
            <div className="dossier-canvas min-h-screen bg-black font-mono text-zinc-100 selection:bg-accent/20">
              {!profileRoute && <SpaceBackdrop />}
              {!profileRoute && !noGlowRoute && <AmbientGlow />}
              <GlassTilt />
              {/* horizon line — thin accent scanline at the bottom for retro hint */}
              <div
                aria-hidden
                className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-px opacity-25"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, rgb(var(--accent-rgb)/0.55), transparent)'
                }}
              />
              <AppNav />
              {/* The arena's fixed streak layers, hoisted out of
                  LeaderboardClient: position:fixed dies inside the
                  transformed scroll-friction content below, so the
                  leaderboard's instance must live at shell level.
                  Route-gated — other pages don't pay for it (the
                  dashboard keeps its own in-page instance; it never
                  scroll-smooths). */}
              {pathname === '/leaderboard' && <AsteroidShower />}
              {/* Stable scroll-friction boundary: LeaderboardScrollRuntime
                  mounts a GSAP ScrollSmoother on these two divs while
                  /leaderboard is on stage. Inert, style-free wrappers on
                  every other route — no positioning, no stacking context —
                  so nothing else changes. Everything that must stay
                  position:fixed (nav, backdrops, asteroids, portaled
                  modals) sits OUTSIDE; the billboard stays INSIDE so its
                  expand keeps pushing page content down in-flow. */}
              <div id="app-flow-wrapper">
                <div id="app-flow-content">
                  <div className="app-nav-inset relative z-10">
                    {/* first in-flow child so the banner pushes page content down;
                        self-gates by pathname (dashboard/leaderboard) + frequency cap.
                        Stays on the canvas, above the profile's paper wrapper: it only
                        ever crosses a profile route mid-collapse, in its own chrome. */}
                    <BillboardTicker />
                    {/* Style-free on every other route. On profile routes .pf-page
                        paints the paper around the record and fills the viewport
                        under the nav (min-height in globals.css) on short pages. */}
                    <div className={profileRoute ? 'pf-page' : undefined}>{children}</div>
                  </div>
                </div>
              </div>
            </div>
            {/* fixed lower-right VFD readout; self-gates on playback state */}
            <NowPlayingTicker />
          </SfxProvider>
        </BackgroundMusicProvider>
      </NavStatusProvider>
    </NavPrefsProvider>
  )
}
