#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const envExample = `# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Cron Job Security (generate a random string)
CRON_SECRET=your-random-secret-here

# Admin Panel Security
NEXT_PUBLIC_ADMIN_PASSWORD=your-secure-admin-password-here

# Optional: Analytics
NEXT_PUBLIC_VERCEL_ANALYTICS_ID=your-analytics-id

# Optional: Custom Domain
NEXT_PUBLIC_DOMAIN=https://cribble.dev
`;

const envPath = path.join(__dirname, '..', '.env.example');

try {
  fs.writeFileSync(envPath, envExample);
  console.log('✅ .env.example created successfully');
} catch (error) {
  console.error('❌ Failed to create .env.example:', error.message);
  process.exit(1);
} 