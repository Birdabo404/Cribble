# Cribble

AI usage leaderboard for developers. Cribble tracks time spent on AI tools via a
browser extension and ranks users on a global leaderboard at
[cribble.dev](https://cribble.dev).

## Stack

- [Next.js 14](https://nextjs.org/) (App Router) with TypeScript and Tailwind CSS
- [Supabase](https://supabase.com/) (Postgres, RLS) with Prisma for schema reference
- NextAuth with GitHub OAuth
- Vitest for unit tests

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values. Supabase keys come
   from your project's API settings; see the comments in the file for where to
   find each one.

3. Set up the database by running the SQL files in `migrations/` against your
   Supabase project (SQL editor or `psql`), in numeric order. Each migration is
   idempotent and safe to re-run.

4. Start the dev server:

   ```bash
   npm run dev
   ```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app` | Routes and pages (App Router), including `api/` route handlers |
| `src/lib` | Auth, scoring, rate limiting, Supabase clients, validation |
| `migrations` | Ordered SQL migrations for the Supabase database |
| `prisma` | Prisma schema (reference for the database shape) |
| `public` | Static assets |

## Testing

```bash
npm test        # watch mode
npm run test:run
```

## Related repositories

- Browser extension: collects AI usage events and syncs them to the API.

## License

MIT
