import { NextRequest } from 'next/server'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

const supabase = createServiceClient()

export type AdminUserResult =
  | { ok: true; userId: number; username: string | null }
  | { ok: false; status: number; error: string }

export function adminUsernameAllowlist(): string[] {
  return (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowlistedAdmin(username: string | null | undefined): boolean {
  if (!username) return false
  return adminUsernameAllowlist().includes(username.toLowerCase())
}

export async function getAdminUser(request: NextRequest): Promise<AdminUserResult> {
  const session = await getSessionUserId(request)
  if (!session.ok) {
    return session
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, twitter_username, is_admin')
    .eq('id', session.userId)
    .single()

  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const isAdmin = user.is_admin === true || isAllowlistedAdmin(user.twitter_username)
  if (!isAdmin) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, userId: Number(user.id), username: user.twitter_username ?? null }
}
