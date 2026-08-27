import { Fragment } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { createServiceClient } from '@/lib/supabaseServer'
import { loadInviteLinkState, type InviteLinkState } from '@/lib/inviteLinkState'
import { inviteKeyCells } from '@/lib/inviteCodes'
import { JoinRedirect } from './JoinRedirect'

export const dynamic = 'force-dynamic'

interface JoinPageProps {
  params: Promise<{ code: string }>
}

const VERIFY_TITLE = 'Checking invite | Cribble'
const VERIFY_DESCRIPTION = 'Verify this Cribble invite link before continuing.'
const VALID_TITLE = "You're Invited!"
const VALID_DESCRIPTION =
  'A personal invite to Cribble — join through this link so the invite still counts, then see where you rank on the AI coding leaderboard.'

async function stateFor(code: string): Promise<InviteLinkState> {
  try {
    return await loadInviteLinkState(createServiceClient(), code)
  } catch {
    return { status: 'error' }
  }
}

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const { code } = await params
  const state = await stateFor(code || '')
  const valid = state.status === 'valid'
  const title = valid ? VALID_TITLE : VERIFY_TITLE
  const description = valid ? VALID_DESCRIPTION : VERIFY_DESCRIPTION
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', siteName: 'Cribble' },
    twitter: { card: 'summary_large_image', title, description }
  }
}

const copy: Record<Exclude<InviteLinkState['status'], 'valid'>, { title: string; detail: string }> = {
  invalid: {
    title: 'INVITE NOT VALID',
    detail: 'Check the link and ask the sender for a new invite.'
  },
  expired: {
    title: 'INVITE EXPIRED',
    detail: 'Ask the sender for a new invite.'
  },
  used: {
    title: 'INVITE ALREADY USED',
    detail: 'This invite has no uses remaining.'
  },
  error: {
    title: 'COULD NOT CHECK INVITE',
    detail: 'The invite service is unavailable. Try again shortly.'
  }
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params
  const state = await stateFor(code || '')
  const valid = state.status === 'valid'
  const href = valid ? `/login?invite=${encodeURIComponent(state.code)}` : '/login'
  const cells = valid ? inviteKeyCells(state.code) : null
  const message = valid ? null : copy[state.status]

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#05060a] px-6 text-center font-mono">
      {valid ? <JoinRedirect href={href} /> : null}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(560px 380px at 50% 36%, rgb(252 255 0 / 0.07), transparent 70%)' }} />
      <div className="relative flex max-w-lg flex-col items-center" data-invite-state={state.status}>
        <Image src="/brand/cribble-mark.png" alt="Cribble" width={64} height={64} priority className="h-16 w-16" />
        <p className="mt-7 flex items-center gap-2.5 text-[10px] tracking-[0.32em] text-zinc-500">
          <span className={`h-1.5 w-1.5 rounded-full ${valid ? 'bg-[#fcff00] shadow-[0_0_8px_rgb(252_255_0/0.7)]' : 'bg-zinc-600'}`} />
          {valid ? 'INVITE VERIFIED' : 'INVITE CHECK'}
        </p>
        <h1 className="mt-4 flex flex-col items-center gap-2 text-xl leading-relaxed [font-family:var(--font-pixel)] sm:text-2xl">
          {valid ? (
            <><span className="text-zinc-100">YOU&apos;RE</span><span className="text-[#fcff00]" style={{ textShadow: '0 0 18px rgb(252 255 0 / 0.35)' }}>INVITED!</span></>
          ) : (
            <span className="text-zinc-100">{message!.title}</span>
          )}
        </h1>
        {cells ? (
          <div className="mt-7 flex items-center gap-1.5" aria-label="Verified invite code">
            <span className="flex h-11 shrink-0 items-center rounded-lg border border-zinc-800 bg-black/30 px-2 font-mono text-xs tracking-[0.08em] text-zinc-500">CRIB</span>
            {cells.map((char, i) => <Fragment key={`${char}-${i}`}>{i === 4 && <span className="h-px w-2 shrink-0 bg-zinc-700" />}<span className="flex h-11 w-10 items-center justify-center rounded-lg border border-[rgb(252_255_0/0.28)] bg-[rgb(252_255_0/0.05)] font-mono text-lg text-[#fcff00]">{char}</span></Fragment>)}
          </div>
        ) : null}
        {message ? <p className="mt-7 text-sm leading-6 text-zinc-400">{message.detail}</p> : null}
        {valid ? <p className="mt-7 animate-pulse text-[10px] tracking-[0.3em] text-zinc-500">TAKING YOU TO SIGN IN…</p> : null}
        <a href={href} className="mt-8 rounded-xl border border-zinc-800 bg-black/30 px-5 py-3 text-[11px] tracking-[0.25em] text-zinc-300 transition-colors hover:border-[rgb(252_255_0/0.5)] hover:text-[#fcff00]">
          {valid ? 'CONTINUE TO SIGN IN →' : state.status === 'error' ? 'TRY SIGN IN →' : 'SIGN IN WITHOUT INVITE →'}
        </a>
      </div>
      <p className="pointer-events-none absolute bottom-6 text-[10px] tracking-[0.3em] text-zinc-700">CRIBBLE.DEV</p>
    </main>
  )
}
