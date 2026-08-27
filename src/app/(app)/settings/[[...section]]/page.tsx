// Settings now lives in a floating modal (SettingsModalHost, mounted by
// the (app) layout) instead of dedicated pages. Old /settings/* URLs —
// bookmarks, external links, in-app hrefs — land here and bounce to the
// dashboard with the section in the query string, which the modal host
// consumes to open the dialog.

import { redirect } from 'next/navigation'
import { isSettingsSectionId } from '@/components/settings/sectionIds'

export default async function SettingsRedirectPage({
  params
}: {
  params: Promise<{ section?: string[] }>
}) {
  const { section } = await params
  const requested = section?.[0] ?? ''
  const target = isSettingsSectionId(requested) ? requested : 'account'
  redirect(`/dashboard?settings=${target}`)
}
