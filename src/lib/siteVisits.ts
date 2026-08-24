import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'

export type VisitorPulse = {
  live: number
  last12h: number
}

const BOT_UA_MARKERS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'scraper',
  'curl/',
  'wget/',
  'python-requests',
  'axios/',
  'node-fetch',
  'httpie',
  'postmanruntime',
  'insomnia',
  'headless',
  'phantom',
  'puppeteer',
  'playwright'
] as const

export function isAnalyticsDbConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return Boolean(url && key && !url.includes('placeholder') && url !== 'undefined')
}

export function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  return forwarded?.split(',')[0]?.trim() || realIp?.trim() || 'unknown'
}

export function isLikelyBot(userAgent: string): boolean {
  const ua = userAgent.trim().toLowerCase()
  if (!ua) return true
  return BOT_UA_MARKERS.some((marker) => ua.includes(marker))
}

export function isTrackingDeclined(headers: Headers): boolean {
  const dnt = headers.get('dnt')?.trim()
  if (dnt === '1') return true
  const gpc = headers.get('sec-gpc')?.trim()
  return gpc === '1'
}

export function visitSalt(): string {
  return (
    process.env.SITE_VISIT_SALT?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    'cribble-dev-visit-salt'
  )
}

export function visitorHash(ip: string, userAgent: string, salt = visitSalt()): string {
  return createHash('sha256')
    .update(`${salt}\n${ip}\n${userAgent}`)
    .digest('hex')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function finiteCount(value: unknown): number | null {
  if (typeof value === 'bigint' && value >= BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

/** Pull `{ live, last12h }` out of a `RETURNS TABLE` RPC envelope. */
export function readVisitorPulse(payload: unknown): VisitorPulse | null {
  const row = Array.isArray(payload) ? asRecord(payload[0]) : asRecord(payload)
  if (!row) return null
  const live = finiteCount(row.live)
  const last12h = finiteCount(row.last12h)
  if (live === null || last12h === null) return null
  return { live, last12h }
}
