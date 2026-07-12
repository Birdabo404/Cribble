import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Next.js patches the global fetch and runs GET responses through its Data
// Cache. Even with `dynamic = 'force-dynamic'` route handlers, Supabase REST
// reads were being persisted to .next/cache/fetch-cache with a 1-year
// revalidate — freezing leaderboard/dashboard scores at whatever value the
// first request after boot saw. Every server-side Supabase client must
// therefore opt its requests out of the cache explicitly.
export const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' })

/** Service-role Supabase client for API routes; never caches reads. */
export function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: noStoreFetch }
    }
  )
}
