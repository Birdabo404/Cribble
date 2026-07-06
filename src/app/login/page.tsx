'use client'

import GitHubLoginButton from '@/components/GitHubLoginButton'
import { AuthStatusBoard } from '@/components/AuthStatus'

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-md border border-[#02fe01]/25 bg-zinc-950/80 p-8 font-mono shadow-[0_0_44px_rgba(2,254,1,0.08)]">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-[#02fe01]/25 px-3 py-1 text-[10px] tracking-[0.22em] text-gray-400">
            <span className="h-2 w-2 rounded-full bg-[#02fe01] shadow-[0_0_8px_rgba(2,254,1,0.5)]" />
            CRIBBLE_LOGIN
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-gray-400">
            Public sign-in isn&apos;t open yet — cribble is in private beta.
          </p>
        </div>

        <AuthStatusBoard />

        <div className="space-y-3 border-t border-white/5 pt-5">
          <p className="text-center text-[10px] tracking-[0.25em] text-zinc-600">
            HAVE A BETA INVITE?
          </p>
          <GitHubLoginButton className="w-full justify-center" variant="primary" />
        </div>

        <p className="text-center text-xs text-gray-500">
          No invite yet?{' '}
          <a
            href="/"
            className="text-[#02fe01]/80 underline-offset-2 transition-colors hover:text-[#02fe01]"
          >
            join the waitlist
          </a>
          .
        </p>
      </div>
    </main>
  )
}
