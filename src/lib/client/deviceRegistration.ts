'use client'

// Binds an extension device to the signed-in user by posting an empty
// sync batch to /api/extension/sync — the same call the extension makes
// for real events, so one server path owns registration and every
// registration rotates the device's sync token. Lived inside
// useExtensionSync until the welcome wizard needed to link a device
// before the dashboard ever mounts; both callers share this so the
// request shape can never drift between them.

export interface RegistrationResult {
  ok: boolean
  syncToken: string | null
}

// Coarse cohort dimension for aggregate insights. Guarded because some
// embedders/browsers throw on Intl access; registration must never fail
// over a missing timezone.
export function detectTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof timezone === 'string' && timezone.length > 0 ? timezone : null
  } catch {
    return null
  }
}

export async function registerDeviceWithBackend(
  userId: number,
  deviceUuid: string
): Promise<RegistrationResult> {
  const timezone = detectTimezone()
  const res = await fetch('/api/extension/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceUuid,
      userId,
      events: [],
      batchId: crypto.randomUUID(),
      ...(timezone ? { timezone } : {})
    })
  })
  if (!res.ok) return { ok: false, syncToken: null }

  try {
    const body = await res.json()
    return {
      ok: true,
      syncToken: typeof body.syncToken === 'string' ? body.syncToken : null
    }
  } catch {
    return { ok: true, syncToken: null }
  }
}
