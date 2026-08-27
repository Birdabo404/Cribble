'use client'

// Mounts the settings modal for every (app) page and handles deep links:
// the old /settings/* routes 307 to /dashboard?settings=<section>, and any
// (app) URL carrying ?settings=<section> opens the modal directly. The
// param is consumed (stripped via replaceState) so a refresh or a copied
// URL doesn't re-open the dialog.
//
// useSearchParams needs a Suspense boundary during prerender, so the
// param watcher lives in an inner component behind one — the host itself
// stays safe to mount from the server (app) layout.

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { isSettingsSectionId } from './sectionIds'
import { SettingsModal } from './SettingsModal'
import { useSettingsModal } from './SettingsModalContext'

function SettingsModalHostInner({ fontVariable }: { fontVariable: string }) {
  const { section, openSettings, closeSettings } = useSettingsModal()
  const searchParams = useSearchParams()

  useEffect(() => {
    const requested = searchParams.get('settings')
    if (!requested || !isSettingsSectionId(requested)) return
    openSettings(requested)
    const params = new URLSearchParams(window.location.search)
    params.delete('settings')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    )
  }, [searchParams, openSettings])

  if (!section) return null

  return (
    <SettingsModal
      section={section}
      fontVariable={fontVariable}
      onSelectSection={openSettings}
      onClose={closeSettings}
    />
  )
}

export function SettingsModalHost({ fontVariable }: { fontVariable: string }) {
  return (
    <Suspense fallback={null}>
      <SettingsModalHostInner fontVariable={fontVariable} />
    </Suspense>
  )
}
