// Environment variable validation and type safety

function validateEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function validateOptionalEnvVar(name: string, value: string | undefined): string | undefined {
  return value
}

function validateUrl(name: string, value: string | undefined): string {
  const url = validateEnvVar(name, value)
  try {
    new URL(url)
    return url
  } catch {
    throw new Error(`Invalid URL format for environment variable: ${name}`)
  }
}

function validateOptionalUrl(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    new URL(value)
    return value
  } catch {
    throw new Error(`Invalid URL format for environment variable: ${name}`)
  }
}

function validateJWT(name: string, value: string | undefined): string {
  const jwt = validateEnvVar(name, value)
  if (!jwt.startsWith('eyJ')) {
    throw new Error(`Invalid JWT format for environment variable: ${name}`)
  }
  return jwt
}

function validateOptionalJWT(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('eyJ')) {
    throw new Error(`Invalid JWT format for environment variable: ${name}`)
  }
  return value
}

const isProduction = process.env.NODE_ENV === 'production'
const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build'

// Validate all required environment variables
export const env = {
  // Supabase (required in production, optional in development)
  NEXT_PUBLIC_SUPABASE_URL: (isProduction && !isBuildTime)
    ? validateUrl('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
    : validateOptionalUrl('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: (isProduction && !isBuildTime)
    ? validateJWT('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : validateOptionalJWT('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: (isProduction && !isBuildTime)
    ? validateJWT('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY)
    : validateOptionalJWT('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  
  // Cron security (optional in development)
  CRON_SECRET: (isProduction && !isBuildTime)
    ? validateEnvVar('CRON_SECRET', process.env.CRON_SECRET)
    : validateOptionalEnvVar('CRON_SECRET', process.env.CRON_SECRET) || 'dev-cron-secret',
  
  // Debug tokens (server-side only, never expose to client)
  DEBUG_RESET_TOKEN: process.env.DEBUG_RESET_TOKEN,
  DEBUG_CLEANUP_TOKEN: process.env.DEBUG_CLEANUP_TOKEN,

  // Optional
  NEXT_PUBLIC_VERCEL_ANALYTICS_ID: process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_ID,
  NEXT_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_DOMAIN || 'https://cribble.dev',
  ADMIN_USERNAMES: process.env.ADMIN_USERNAMES,
  NODE_ENV: process.env.NODE_ENV || 'development',
}

// Runtime validation (only run in runtime, not during build)
if (typeof window === 'undefined' && !isBuildTime) {
  // Server-side validation
  if (isProduction) {
    console.log('✅ Production environment variables validated successfully')
    
    // Additional security checks
    if (env.CRON_SECRET && env.CRON_SECRET.length < 32) {
      console.warn('⚠️  CRON_SECRET should be at least 32 characters in production')
    }
    
    if (!env.NEXT_PUBLIC_DOMAIN?.startsWith('https://')) {
      console.warn('⚠️  NEXT_PUBLIC_DOMAIN should use HTTPS in production')
    }
  } else {
    console.log('✅ Development environment - some variables are optional')
  }
} 