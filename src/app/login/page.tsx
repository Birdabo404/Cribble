'use client'

import GitHubLoginButton from '@/components/GitHubLoginButton'
import TwitterLoginButton from '@/components/TwitterLoginButton'

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-gradient-to-b from-[#0b0b0b] to-[#050505] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400">
            <span className="h-2 w-2 rounded-full bg-[#02fe01] shadow-[0_0_8px_rgba(2,254,1,0.5)]" />
            Cribble Login
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-gray-400">
            Choose a provider to connect your account.
          </p>
        </div>

        <div className="space-y-3">
          <TwitterLoginButton className="w-full justify-center" variant="secondary" />
          <GitHubLoginButton className="w-full justify-center" variant="primary" />
        </div>

        <p className="text-center text-xs text-gray-500">
          You can change providers later in your account settings.
        </p>
      </div>
    </main>
  )
}

