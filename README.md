# cribble.

The worldwide leaderboard for AI users — [cribble.dev](https://cribble.dev)

Cribble tracks your activity on ChatGPT, Claude, Cursor, and 30+ other AI tools through a silent browser extension, turns it into a score, and ranks you against everyone else. Build a streak. Climb the board. Or just lurk.

> Currently in private beta, invite only.

## How it works

- The browser extension logs time spent on AI tools locally, then syncs in the background.
- Activity is scored per day: active time, visits, and which tools you used.
- Scores roll up into seasons; the leaderboard updates live.

## Landing

![Landing](docs/landing.png)

## Dashboard

Total score, streaks, a 12-week activity heatmap, and your top tools by contribution.

![Dashboard](docs/dashboard.png)

## Leaderboard

Season standings with live sync, top-3 podium, and player search.

![Leaderboard](docs/leaderboard.png)

## Stack

Next.js 14, TypeScript, Tailwind CSS, Supabase, and a Chrome extension.

## Monetization (Cribble Pro + Plates)

Ops runbook for the `/shop` storefront. Payments run through [Polar.sh](https://polar.sh) as merchant of record; the app never touches card data. Everything is strictly cosmetic.

### Env vars

All in `.env.example` under the Polar block:

| Var | What it is |
| --- | --- |
| `POLAR_ACCESS_TOKEN` | Organization access token (Settings → Developers) |
| `POLAR_SERVER` | `sandbox` (default) or `production` — must match the token |
| `POLAR_WEBHOOK_SECRET` | Secret from the webhook endpoint config |
| `POLAR_PRODUCT_PRO_MONTHLY` / `POLAR_PRODUCT_PRO_YEARLY` | Pro subscription product ids ($6.99/mo, $49.99/yr) |
| `POLAR_PLATE_PRODUCT_MAP` | JSON map of catalog `plateId` → Polar product id |
| `POLAR_DISCOUNT_PRO_PLATES` | Optional 25% discount id, auto-applied to plate checkouts for Pro members |

Unset vars degrade gracefully: checkout routes answer 503, the shop stays browsable.

### Polar setup (one command)

`scripts/setup-polar.ts` provisions the whole organization from the plate catalog — subscription products, one product per plate (with `plate_id` metadata), the 25% Pro discount and the webhook endpoint — and prints the finished `POLAR_*` env block. It is idempotent: reruns reuse existing objects, create only what's missing, and report price drift without touching live prices.

```bash
# 1. Put an org access token in .env.local (sandbox.polar.sh token while POLAR_SERVER=sandbox)
#    POLAR_ACCESS_TOKEN=polar_oat_…

# 2. Provision + write the env block into .env.local
npm run setup:polar -- --write-env --url https://cribble.dev

# Later: read-only drift audit (exit 1 when something is missing/drifted)
npm run setup:polar:check
```

Flags: `--check` (read-only), `--write-env` (upsert the block into `.env.local`), `--url https://<domain>` (webhook target; defaults to `NEXT_PUBLIC_APP_URL` when it is https, skipped otherwise — localhost needs a tunnel), `--production` (required for writes when `POLAR_SERVER=production`).

One-time transition note: the founder promo subscription is retired — archive the "Cribble Pro — Founder" product in the Polar dashboard and delete `POLAR_PRODUCT_PRO_FOUNDER` from `.env.local` and the deployment env. Then re-run `npx vite-node scripts/setup-polar.ts --write-env`: the Founder plate is provisioned as a normal one-time product and the 25% Pro discount extends to it.

Manual dashboard equivalent, if you'd rather click: create the two subscriptions ($6.99/mo, $49.99/yr), one one-time product per plate with `plate_id` metadata (prices from `src/lib/cosmetics/plates.ts`), a 25% discount over the plate products, and a webhook endpoint (raw format) at `https://<domain>/api/webhooks/polar` subscribed to subscription + order events.

Going live is the same flow with a production token: set `POLAR_SERVER=production`, swap `POLAR_ACCESS_TOKEN`, re-run with `--production`, and copy the printed env block into the deployment's env. Polar requires org verification before real payouts.

### Money flow

- `/api/checkout?type=pro_monthly|pro_yearly|plate&plateId=…` resolves the product server-side and redirects to Polar's hosted checkout (`externalCustomerId` = `users.id`).
- `/api/webhooks/polar` (signature-verified, idempotent via `payment_events`): `subscription.active` → `users.subscription_tier = 'PRO'`; `subscription.revoked` → `'FREE'`; `order.paid` with `plate_id` → `user_cosmetics` grant; `order.refunded` → grant deleted by order id.
- Entitlements are re-checked at read time (`src/lib/entitlements.ts`): downgrades self-heal with no cron — lapsed Pros lose animated banners and Pro-exclusive plates on the next read, purchases stay forever.

### GIF banners (Klipy)

The Banner Studio on `/u/[username]` (owner-only EDIT BANNER chip) lets Pro members pick an animated banner from [Klipy](https://klipy.com)'s free GIF API — searches go through `GET /api/gifs` so the key never reaches the browser, and Klipy's required "Powered by KLIPY" attribution renders in the picker. Setup: create a platform at [partner.klipy.com](https://partner.klipy.com) and set `KLIPY_API_KEY`. Test keys allow 100 calls/min; request the (also free) production key from the same panel before launch. Unset, the GIF tab reports itself offline while paste-a-URL banners keep working. The Pro gate itself is unchanged: `PATCH /api/user/profile` byte-sniffs any new banner URL and rejects animated ones for free accounts.
