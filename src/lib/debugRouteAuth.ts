import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { getStaffUser, type StaffUserResult } from '@/lib/staffAuth'

export type DebugTokenName = 'DEBUG_RESET_TOKEN' | 'DEBUG_CLEANUP_TOKEN'

/**
 * Debug APIs are compiled into the Next.js route manifest, so NODE_ENV by
 * itself is not enough of an operational control. They require an explicit
 * local opt-in and owner authorization; the default is a 404 in every
 * environment, including ordinary `next dev`.
 */
export async function getDebugStaffUser(request: NextRequest): Promise<StaffUserResult> {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.ENABLE_DANGEROUS_DEBUG_ROUTES !== 'true'
  ) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  return getStaffUser(request, 'debug.manage')
}

/**
 * No static fallback secret. A destructive debug route only unlocks when
 * its dedicated env token exists, is at least 32 characters, and matches
 * in constant time.
 */
export function hasValidDebugToken(value: unknown, tokenName: DebugTokenName): boolean {
  const expected = process.env[tokenName]
  if (typeof value !== 'string' || !expected || expected.length < 32) return false

  const suppliedBytes = Buffer.from(value)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}
