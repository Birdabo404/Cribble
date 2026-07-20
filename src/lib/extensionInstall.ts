import type { ActiveDevice, MeUser } from '@/types/dashboard'

// Chrome Web Store listing URL. Null until the listing is live — every
// install surface (welcome step, dashboard nudge, settings link) hides
// itself when null, so this can ship before store approval.
export const EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL?.trim() || null

// Never-connected is distinct from temporarily offline: a user whose
// extension synced before (last_extension_sync set) just has it off/asleep
// and shouldn't be told to install. A null user means data hasn't loaded,
// which is not evidence of being unlinked.
export function isExtensionUnlinked(
  user: Pick<MeUser, 'last_extension_sync'> | null,
  activeDevice: Pick<ActiveDevice, 'device_uuid'> | null
): boolean {
  if (!user) return false
  return !activeDevice && !user.last_extension_sync
}
