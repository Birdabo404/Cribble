import Link from 'next/link'

export function ErrorScreen({ message }: { message: string | null }) {
  return (
    <div className="dossier-canvas min-h-dvh bg-black text-zinc-100 font-mono flex items-center justify-center px-4">
      <div className="border border-zinc-800 bg-zinc-950 rounded-xl p-8 text-center max-w-sm">
        <div className="text-xs tracking-[0.4em] text-rose-400 mb-3">SESSION ERROR</div>
        <p className="text-sm text-zinc-400 mb-6">{message || 'You are signed out.'}</p>
        <Link
          href="/login"
          className="inline-block text-xs tracking-[0.3em] px-4 py-3.5 border border-zinc-700 rounded hover:border-zinc-500 transition-colors sm:py-2"
        >
          SIGN IN
        </Link>
      </div>
    </div>
  )
}
