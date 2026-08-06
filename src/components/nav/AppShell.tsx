'use client'

// Persistent chrome for all authenticated pages, mounted once by the
// (app) route-group layout. Because the layout survives client-side
// navigation, the nav and backdrop never remount between pages — route
// changes only swap the content inside .app-nav-inset.
//
// Exception: profile routes drop the animated starfield + glow. The
// profile page mounts its own static banner-derived aurora
// (ProfileAmbience), so the two backdrops would fight — and the ~70
// looping twinkle animations made the profile feel heavy.

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { BillboardRails } from '@/components/billboard/BillboardRails'
import { BillboardTicker } from '@/components/billboard/BillboardTicker'
import { AmbientGlow } from '@/components/dashboard-v3/AmbientGlow'
import { GlassTilt } from '@/components/dashboard-v3/GlassTilt'
import { AppNav } from './AppNav'
import { NavPrefsProvider } from './NavPrefsContext'
import { NavStatusProvider } from './NavStatusContext'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const profileRoute = pathname === '/profile' || pathname.startsWith('/u/')

  return (
    <NavPrefsProvider>
      <NavStatusProvider>
        <div className="dossier-canvas min-h-screen bg-black font-mono text-zinc-100 selection:bg-accent/20">
          {!profileRoute && <SpaceBackdrop />}
          {!profileRoute && <AmbientGlow />}
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
          <div className="app-nav-inset relative z-10">
            {/* first in-flow child so the banner pushes page content down;
                self-gates by pathname (dashboard/leaderboard) + frequency cap */}
            <BillboardTicker />
            {/* fixed sponsor columns flanking the profile pages; self-gates
                by pathname (profile routes) + ≥1440px viewports */}
            <BillboardRails />
            {children}
          </div>
        </div>
      </NavStatusProvider>
    </NavPrefsProvider>
  )
}
