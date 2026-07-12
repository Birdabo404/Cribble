'use client'

// Persistent chrome for all authenticated pages, mounted once by the
// (app) route-group layout. Because the layout survives client-side
// navigation, the nav, starfield, and ambient glow never remount between
// pages — route changes only swap the content inside .app-nav-inset.

import type { ReactNode } from 'react'
import SpaceBackdrop from '@/components/SpaceBackdrop'
import { AmbientGlow } from '@/components/dashboard-v3/AmbientGlow'
import { GlassTilt } from '@/components/dashboard-v3/GlassTilt'
import { AppNav } from './AppNav'
import { NavPrefsProvider } from './NavPrefsContext'
import { NavStatusProvider } from './NavStatusContext'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <NavPrefsProvider>
      <NavStatusProvider>
        <div className="min-h-screen bg-black font-mono text-zinc-100 selection:bg-accent/20">
          <SpaceBackdrop />
          <AmbientGlow />
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
          <div className="app-nav-inset relative z-10">{children}</div>
        </div>
      </NavStatusProvider>
    </NavPrefsProvider>
  )
}
