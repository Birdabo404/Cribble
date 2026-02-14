import { createClient } from '@supabase/supabase-js'

// Check if environment variables are configured
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const isConfigured = supabaseUrl && 
                    supabaseServiceKey && 
                    !supabaseUrl.includes('placeholder') &&
                    supabaseUrl !== 'undefined'

// Supabase admin client with enhanced configuration for server-side operations
export const supabaseAdmin = isConfigured 
  ? createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          'X-Client-Info': 'cribble-admin'
        }
      },
      db: {
        schema: 'public'
      }
    })
  : null

// Helper function to check if database is available
export const isDatabaseConfigured = () => isConfigured

// Connection health check function
export const checkDatabaseHealth = async () => {
  if (!supabaseAdmin) return false
  
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .limit(1)
    
    return !error
  } catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
} 