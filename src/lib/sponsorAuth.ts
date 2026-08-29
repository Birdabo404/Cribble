import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from './sessionAuth'
import { createServiceClient } from './supabaseServer'

// Guest identity for the no-login sponsor flow. A guest is a
// billboard_guests row (migration 063) whose random bearer token lives in
// the httpOnly cribble_sponsor_claim cookie and in an emailed magic link
// (/api/billboard/claim). Sponsorship routes resolve a SponsorIdentity
// that is either the signed-in user (existing path, unchanged), a guest,
// or nobody — the token itself stays inside cookie + email; everything
// else (Polar metadata, ledger rows) carries the numeric guestId.

export const SPONSOR_CLAIM_COOKIE = 'cribble_sponsor_claim'

// Long-lived on purpose: the cookie is how a guest returns to pay after
// review, which can be days later. The emailed magic link remains the
// recovery path once it expires.
const SPONSOR_CLAIM_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

const serviceClient = createServiceClient()

export type SponsorIdentity =
  | { kind: 'user'; userId: number }
  | { kind: 'guest'; guestId: number }
  | { kind: 'none' }

/** The buyer a targeted checkout sync filters its ledger on — a
 *  SponsorIdentity narrowed to the two kinds that can own money. */
export type SponsorBuyer = { userId: number } | { guestId: number }

export type SponsorIdentityResult =
  | { ok: true; identity: SponsorIdentity }
  | { ok: false; status: number; error: string }

/**
 * Resolve who is sponsoring: the signed-in user wins, then the guest
 * claim cookie, then nobody. Mirrors sessionAuth's 401-vs-503 stance —
 * only a definitive 401 (missing/invalid session) falls through to the
 * guest cookie; a lookup failure propagates as a retryable error rather
 * than silently downgrading a signed-in buyer to guest or anonymous.
 */
export async function getSponsorIdentity(request: NextRequest): Promise<SponsorIdentityResult> {
  const session = await getSessionUserId(request)
  if (session.ok) {
    return { ok: true, identity: { kind: 'user', userId: session.userId } }
  }
  if (session.status !== 401) {
    return { ok: false, status: session.status, error: session.error }
  }

  const token = request.cookies.get(SPONSOR_CLAIM_COOKIE)?.value
  if (!token) {
    return { ok: true, identity: { kind: 'none' } }
  }

  const { data, error } = await serviceClient
    .from('billboard_guests')
    .select('id')
    .eq('token', token)
    .maybeSingle()

  // Same rule as the session path: a failed lookup is not proof the
  // cookie is stale, so it must not quietly become 'none'.
  if (error) {
    console.error('[SponsorAuth] Guest lookup failed:', error.message)
    return { ok: false, status: 503, error: 'Guest lookup failed' }
  }

  // A cookie that matches no row (revoked guest, forged value) is plain
  // anonymity — the caller treats it exactly like no cookie at all.
  if (!data) {
    return { ok: true, identity: { kind: 'none' } }
  }

  return { ok: true, identity: { kind: 'guest', guestId: Number(data.id) } }
}

export type CreateSponsorGuestResult =
  | { ok: true; guestId: number; token: string }
  | { ok: false; error: string }

/**
 * Mint a guest: a fresh 32-byte bearer token plus its billboard_guests
 * row. The caller owns what happens next — setting the claim cookie on
 * its response and emailing the magic link.
 */
export async function createSponsorGuest(
  supabase: SupabaseClient,
  email: string
): Promise<CreateSponsorGuestResult> {
  const token = randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('billboard_guests')
    .insert({ token, email })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[SponsorAuth] Guest creation failed:', error?.message)
    return { ok: false, error: 'Failed to create guest identity' }
  }

  return { ok: true, guestId: Number(data.id), token }
}

/** Same flags as cribble_session (github/callback), minus the 30-day
 *  horizon — sponsors return on payment-and-renewal timescales. */
export function setSponsorClaimCookie(response: NextResponse, token: string): void {
  response.cookies.set(SPONSOR_CLAIM_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SPONSOR_CLAIM_COOKIE_MAX_AGE_SECONDS
  })
}
