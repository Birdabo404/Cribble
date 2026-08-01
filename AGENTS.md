# AGENTS.md

Cribble — the worldwide leaderboard for AI users. This repo is a single
**Next.js 15 (App Router) + TypeScript** app that contains both the frontend
and the API routes. Data lives in **Supabase/Postgres** (accessed via the
Supabase JS client and Prisma). The Chrome extension that produces activity
data is **not** in this repo.

Standard commands live in `package.json` (`dev`, `build`, `start`, `lint`,
`typecheck`, `test`, `test:run`). CI is `.github/workflows/ci.yml`.

## Cursor Cloud specific instructions

Dependencies are installed by the startup update script (`npm install`), so
you normally don't need to install anything yourself.

### Environment variables are required to build (and for a clean dev boot)

The Supabase JS client throws `supabaseUrl is required` at module load, which
breaks `npm run build` (during "Collecting page data") and makes data API
routes return 500 in `npm run dev` when no Supabase env is set. CI works
around this with placeholder values. Do the same locally by creating a
gitignored `.env.local` (it is not committed) before building or running:

```
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder
SITE_LOCKED=false
NEXT_PUBLIC_SITE_LOCKED=false
```

With these placeholders the app builds, all pages render (200), and
`/api/user/me` returns 401 (unauthenticated) instead of 500 — matching the CI
smoke test. `src/lib/env.ts` intentionally treats Supabase/`CRON_SECRET` as
optional in dev/build and required only in production.

### What works without real external services

Pages render and the storefront (`/shop`) is fully interactive from the static
catalog in `src/lib/cosmetics/plates.ts` (e.g. the Cribble Pro billing-term
selector). The landing page, `/leaderboard` (empty state), `/login`, etc. all
render. Anything that reads/writes data degrades gracefully: data API routes
answer 401/503, the shop stays browsable, the leaderboard shows an empty state.

### What needs real secrets (not available by default)

Full end-to-end auth/data flows require credentials that are **not** in the
environment. Add them as Cursor Secrets to exercise these flows:

- **Login / dashboard / real leaderboard / profiles:** a real Supabase project
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) with `migrations/*.sql` applied,
  **plus** an X (Twitter) and/or GitHub OAuth app (`TWITTER_CLIENT_*`,
  `GITHUB_CLIENT_*`). Login is OAuth-only and invite-gated; there is no
  password/dev-bypass login. Real leaderboard/dashboard data ultimately comes
  from the (external) Chrome extension syncing to `/api/extension/sync`.
- **Checkout / Pro / plate purchases (`/shop` → `/api/checkout`):** Polar.sh
  (`POLAR_*`). Unset → checkout routes answer 503; the shop still browses.
- **Animated GIF banners:** Klipy (`KLIPY_API_KEY`). Unset → GIF tab reports
  offline; URL banners still work.

### Dev server gotcha

`predev` (`scripts/guard-dev-server.mjs`) refuses to start a second `next dev`
for this repo because concurrent dev servers share `.next-dev` and corrupt each
other. Reuse the running server, or force a second one with
`CRIBBLE_ALLOW_SECOND_DEV=1 npm run dev`.

### Notes

- Package manager is **npm** (`package-lock.json`); Node 20 in CI (Node 22 also
  works locally).
- `next build` ignores ESLint errors (`ignoreDuringBuilds: true`), so run
  `npm run lint` and `npm run typecheck` separately — CI does.
- `prisma generate` is **not** required for build/dev/tests to pass.
