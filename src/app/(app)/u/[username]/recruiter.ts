// Who may press INVITE TO TEAM on someone else's record, read off the
// /api/user/me payload. The server's gate is resolveTeamAuthority
// (/api/team/invite, migration 066): a live TEAM login, or a signed
// OWNER's personal account speaking for a live team. /me reports that
// verdict as `team_authority` and names the commanded team as
// `team_handle`, so this is a one-field read rather than a tier check —
// an approved-TEAM test here would hide the button from owners the
// server happily serves. Pure so the gate is pinned by a test.

import type { MeUser } from '@/types/dashboard'

export type RecruiterInput = Pick<MeUser, 'team_authority' | 'team_handle' | 'twitter_username'>

/**
 * Handle of the team this session recruits for, or null when it may
 * not recruit. The franchise arm falls back to the login's own handle
 * for a /me payload that predates team_handle; the owner arm has no
 * such fallback (the owner's handle is not the team's) and reads null,
 * which keeps the button unrendered rather than mislabelled.
 */
export function recruitingTeamHandle(user: RecruiterInput | null | undefined): string | null {
  if (!user) return null
  const authority = user.team_authority ?? null
  switch (authority) {
    case null:
      return null
    case 'team-account':
      return handleOrNull(user.team_handle ?? user.twitter_username)
    case 'owner':
      return handleOrNull(user.team_handle)
    default: {
      const exhaustive: never = authority
      return exhaustive
    }
  }
}

/** True when the pilot already flies the recruiting team's colors —
 *  handles compare case-insensitively, like the server's ilike lookup. */
export function onRecruiterRoster(
  team: { username: string } | null,
  recruiterHandle: string
): boolean {
  return team !== null && team.username.toLowerCase() === recruiterHandle.toLowerCase()
}

function handleOrNull(raw: string | null | undefined): string | null {
  const handle = String(raw ?? '').trim()
  return handle.length > 0 ? handle : null
}
