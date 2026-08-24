import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSessionUserId } from '@/lib/sessionAuth'

export const dynamic = 'force-dynamic'

/**
 * Keep the route private before its client shell mounts. Transient session
 * lookup failures are left to the no-store API so the dashboard can show its
 * retryable failure state instead of incorrectly treating an outage as logout.
 */
export default async function TokenDashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('cribble_session')
  if (!sessionCookie) redirect('/login?next=/dashboard/tokens')

  const request = new NextRequest('http://localhost/dashboard/tokens', {
    headers: { cookie: `cribble_session=${sessionCookie.value}` }
  })
  const session = await getSessionUserId(request)
  if (!session.ok && session.status === 401) {
    redirect('/login?next=/dashboard/tokens')
  }

  return children
}
