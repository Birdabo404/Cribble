import type { Metadata } from 'next'
import { TokenUsageDashboard } from '@/components/tokens/TokenUsageDashboard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Token Usage · Cribble',
  description: 'Your private Cribble Agent token usage dashboard.'
}

export default function TokenUsagePage() {
  return <TokenUsageDashboard />
}
