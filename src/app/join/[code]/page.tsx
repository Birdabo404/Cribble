import { Fragment } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { inviteKeyCells, normalizeInviteCode } from '@/lib/inviteCodes'
import { JoinRedirect } from './JoinRedirect'

// Shareable referral URL: /join/CODE. Crawlers get real HTML here —
// "You're Invited!" metadata plus the colocated opengraph-image card —
// while humans are bounced to /login with the code pre-applied via a
// client-side redirect. No validation on this hop: the login page
// pre-checks and the OAuth callback atomically consumes the code.

interface JoinPageProps {
  params: Promise<{ code: string }>
}

const TITLE = "You're Invited!"
const DESCRIPTION =
  'A personal invite to Cribble — skip the gate, join the AI coding leaderboard, and see where you rank.'

// The interstitial is always deep-space dark regardless of theme, so the
// electric lime (--ref-lime in globals.css) is hard-coded here rather than
// pulled from .referral-scope, which swaps to olive ink in light mode.

function loginHref(normalized: string): string {
  return normalized ? `/login?invite=${encodeURIComponent(normalized)}` : '/login'
}

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const { code } = await params
  const normalized = normalizeInviteCode(code || '')
  return {
    title: TITLE,
    description: DESCRIPTION,
    // Personal links, same convention as /login — noindex does not block unfurls.
    robots: { index: false },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      type: 'website',
      siteName: 'Cribble',
      url: `/join/${encodeURIComponent(normalized || code)}`
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION
    }
    // og:image / twitter:image are injected by the colocated opengraph-image.tsx.
  }
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params
  const normalized = normalizeInviteCode(code || '')
  const cells = inviteKeyCells(normalized)
  const href = loginHref(normalized)

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#05060a] px-6 text-center font-mono">
      <JoinRedirect href={href} />

      {/* faint lime bloom behind the mark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(560px 380px at 50% 36%, rgb(252 255 0 / 0.07), transparent 70%)'
        }}
      />

      <div className="relative flex flex-col items-center">
        <Image
          src="/brand/cribble-mark.png"
          alt="Cribble"
          width={64}
          height={64}
          priority
          className="h-16 w-16"
        />

        <p className="mt-7 flex items-center gap-2.5 text-[10px] tracking-[0.32em] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-[#fcff00] shadow-[0_0_8px_rgb(252_255_0/0.7)]" />
          RECRUIT A PILOT
        </p>

        {/* Two-tone to match the share card: the ask in chalk, the payoff in lime. */}
        <h1 className="mt-4 flex flex-col items-center gap-2 text-xl leading-relaxed [font-family:var(--font-pixel)] sm:text-2xl">
          <span className="text-zinc-100">YOU&apos;RE</span>
          <span
            className="text-[#fcff00]"
            style={{ textShadow: '0 0 18px rgb(252 255 0 / 0.35)' }}
          >
            INVITED!
          </span>
        </h1>

        {cells ? (
          <div className="mt-7 flex items-center gap-1.5">
            <span className="flex h-11 shrink-0 items-center rounded-lg border border-zinc-800 bg-black/30 px-2 font-mono text-xs tracking-[0.08em] text-zinc-500">
              CRIB
            </span>
            {cells.map((char, i) => (
              <Fragment key={`${char}-${i}`}>
                {i === 4 && <span className="h-px w-2 shrink-0 bg-zinc-700" />}
                <span className="flex h-11 w-10 items-center justify-center rounded-lg border border-[rgb(252_255_0/0.28)] bg-[rgb(252_255_0/0.05)] font-mono text-lg text-[#fcff00]">
                  {char}
                </span>
              </Fragment>
            ))}
          </div>
        ) : normalized ? (
          <p className="mt-6 rounded-lg border border-[rgb(252_255_0/0.2)] bg-[rgb(252_255_0/0.04)] px-4 py-2 text-sm tracking-[0.2em] text-zinc-100">
            {normalized}
          </p>
        ) : null}

        <p className="mt-7 animate-pulse text-[10px] tracking-[0.3em] text-zinc-500">
          TAKING YOU TO SIGN IN…
        </p>

        {/* no-JS fallback — the redirect above never fires for these visitors */}
        <a
          href={href}
          className="mt-8 rounded-xl border border-zinc-800 bg-black/30 px-5 py-3 text-[11px] tracking-[0.25em] text-zinc-300 transition-colors hover:border-[rgb(252_255_0/0.5)] hover:text-[#fcff00]"
        >
          CONTINUE TO SIGN IN →
        </a>
      </div>

      <p className="pointer-events-none absolute bottom-6 text-[10px] tracking-[0.3em] text-zinc-700">
        CRIBBLE.DEV
      </p>
    </main>
  )
}
