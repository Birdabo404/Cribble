import { NextRequest, NextResponse } from 'next/server'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

// Leave a team, member side: hard-delete the caller's single ACTIVE
// affiliation row (the partial unique index guarantees at most one).
// Deleting frees the team's seat immediately and clears the partial
// unique index so the member can accept a different invite.

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: session.status })
    }

    const { data: deleted, error } = await supabase
      .from('team_affiliations')
      .delete()
      .eq('member_user_id', session.userId)
      .eq('status', 'active')
      .select('id')

    if (error) {
      console.error('[Team] Leave failed:', error)
      return NextResponse.json({ error: 'Failed to leave team' }, { status: 500 })
    }
    if ((deleted ?? []).length === 0) {
      return NextResponse.json({ error: 'You are not on a team' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Team] Leave DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
