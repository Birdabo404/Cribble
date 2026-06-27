# Cribble

AI usage leaderboard for developers. Built with Next.js, Supabase, and TypeScript.

## Setup

1. Copy `.env.example` to `.env.local` and fill in Supabase + GitHub OAuth values.
2. Apply SQL migrations in `migrations/` to your Supabase project (in order).
3. Install and run:

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — local development server
- `npm run build` — production build
- `npm run test:run` — unit tests

## Database

Schema changes live in `migrations/`. Use those files instead of one-off SQL scripts.
