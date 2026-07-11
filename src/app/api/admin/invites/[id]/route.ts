import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminUser } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Revoke an invite code (soft delete — keeps the redemption history).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser(request)
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    const { id } = await params
    const inviteId = Number(id)
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      return NextResponse.json({ error: 'Invalid invite id' }, { status: 400 })
    }

    const { data: invite, error } = await supabase
      .from('invite_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId)
      .is('revoked_at', null)
      .select('id, code, revoked_at')
      .maybeSingle()

    if (error) {
      console.error('Failed to revoke invite:', error)
      return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 })
    }
    if (!invite) {
      return NextResponse.json({ error: 'Invite not found or already revoked' }, { status: 404 })
    }

    return NextResponse.json({ invite })
  } catch (error) {
    console.error('Admin invite DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
