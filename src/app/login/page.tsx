'use client'

import GitHubLoginButton from '@/components/GitHubLoginButton'

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
            GitHub is the only live auth path during private beta.
          </p>
        </div>

        <div>
          <GitHubLoginButton className="w-full justify-center" variant="primary" />
        </div>

        <p className="text-center text-xs text-gray-500">
          New pilots continue through welcome before the dashboard opens.
        </p>
      </div>
    </main>
  )
}
