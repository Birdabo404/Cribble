import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Enhanced client configuration with connection pooling and error handling
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  },
  global: {
    headers: {
      'X-Client-Info': 'cribble-webapp'
    },
    // This client is also imported by server routes (e.g. waitlist). Next.js
    // patches server fetch with its Data Cache, so reads must opt out; in the
    // browser `no-store` is a harmless HTTP-cache bypass.
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' })
  },
  db: {
    schema: 'public'
  }
}) 