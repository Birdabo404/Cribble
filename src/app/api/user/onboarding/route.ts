import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabaseServer'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

const ROLES = [
  'student',
  'researcher',
  'developer',
  'designer',
  'founder',
  'product',
  'writer',
  'other'
] as const
type Role = (typeof ROLES)[number]

const GOALS = [
  'learn',
  'build',
  'research',
  'work',
  'hobby',
  'other'
] as const
type Goal = (typeof GOALS)[number]

const TOOLS = [
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'cursor',
  'copilot',
  'midjourney',
  'other'
] as const

// "team" is an early-access flag for company accounts — the user still
// tracks solo for now, but we record the intent for when team boards ship.
const ACCOUNT_TYPES = ['solo', 'team'] as const
type AccountType = (typeof ACCOUNT_TYPES)[number]

interface OnboardingPayload {
  role?: Role | null
  goal?: Goal | null
  topTools?: string[]
  accountType?: AccountType | null
  referralSource?: string | null
  newsletter?: boolean
}

const sanitizeString = (v: unknown, max = 80) => {
  if (typeof v !== 'string') return null
  const trimmed = v.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(req: NextRequest) {
  const auth = await getSessionUserId(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, twitter_username, user_type, onboarded_at, metadata, created_at')
    .eq('id', auth.userId)
    .single()

  if (error || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    onboarded: !!user.onboarded_at,
    username: user.twitter_username || null,
    role: user.user_type || null,
    metadata: user.metadata || {},
    createdAt: user.created_at || null
  })
}

export async function POST(req: NextRequest) {
  const auth = await getSessionUserId(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: OnboardingPayload
  try {
    body = (await req.json()) as OnboardingPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const role: Role | null =
    body.role && (ROLES as readonly string[]).includes(body.role)
      ? (body.role as Role)
      : null

  const goal: Goal | null =
    body.goal && (GOALS as readonly string[]).includes(body.goal)
      ? (body.goal as Goal)
      : null

  const topTools = Array.isArray(body.topTools)
    ? body.topTools
        .filter((t): t is string => typeof t === 'string')
        .filter((t) => (TOOLS as readonly string[]).includes(t))
        .slice(0, 8)
    : []

  const accountType: AccountType =
    body.accountType &&
    (ACCOUNT_TYPES as readonly string[]).includes(body.accountType)
      ? body.accountType
      : 'solo'

  const referralSource = sanitizeString(body.referralSource, 60)
  const newsletter = body.newsletter === true

  // Fetch current metadata so we don't blow it away on subsequent saves.
  const { data: existing } = await supabase
    .from('users')
    .select('metadata')
    .eq('id', auth.userId)
    .single()

  const merged = {
    ...(existing?.metadata && typeof existing.metadata === 'object'
      ? existing.metadata
      : {}),
    role,
    goal,
    top_tools: topTools,
    account_type: accountType,
    referral_source: referralSource,
    newsletter,
    onboarding_version: 2
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({
      user_type: role,
      onboarded_at: new Date().toISOString(),
      metadata: merged
    })
    .eq('id', auth.userId)

  if (updateError) {
    console.error('[onboarding] update failed:', updateError)
    return NextResponse.json(
      { error: 'Failed to save onboarding answers' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, onboarded: true })
}
