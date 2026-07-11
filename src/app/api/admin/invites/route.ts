import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/adminAuth'
import { generateInviteCode } from '@/lib/inviteCodes'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser(request)
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    const { data: invites, error } = await supabase
      .from('invite_codes')
      .select(
        `id, code, note, max_uses, use_count, expires_at, revoked_at, created_at,
         invite_redemptions ( user_id, redeemed_at, users ( twitter_username ) )`
      )
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to list invites:', error)
      return NextResponse.json({ error: 'Failed to list invites' }, { status: 500 })
    }

    return NextResponse.json({ invites: invites ?? [] })
  } catch (error) {
    console.error('Admin invites GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser(request)
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    const body = await request.json().catch(() => ({}))
    const maxUses = Number.isInteger(body.maxUses) && body.maxUses > 0 && body.maxUses <= 1000
      ? body.maxUses
      : 1
    const expiresInDays = Number.isFinite(body.expiresInDays) && body.expiresInDays > 0
      ? Math.min(body.expiresInDays, 365)
      : null
    const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

    // Retry on the (unlikely) code collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateInviteCode()
      const { data: invite, error } = await supabase
        .from('invite_codes')
        .insert({
          code,
          created_by: admin.userId,
          note,
          max_uses: maxUses,
          expires_at: expiresAt
        })
        .select('id, code, note, max_uses, use_count, expires_at, revoked_at, created_at')
        .single()

      if (!error) {
        return NextResponse.json({ invite }, { status: 201 })
      }
      if (error.code !== '23505') {
        console.error('Failed to create invite:', error)
        return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Failed to generate a unique code' }, { status: 500 })
  } catch (error) {
    console.error('Admin invites POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
