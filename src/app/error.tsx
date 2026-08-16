'use client'

// Root error boundary — catches render errors beneath the root layout and
// swaps in a recover screen instead of a blank page. Deliberately
// dependency-free (globals.css utilities only) so the fallback itself can't
// re-throw.

import { useEffect } from 'react'

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center font-mono text-zinc-100">
      <p className="text-[10px] tracking-[0.4em] text-zinc-500">
        <span className="text-accent">{'// '}</span>SIGNAL FAULT
      </p>
      <h1 className="mt-5 font-serif text-3xl text-zinc-200 md:text-4xl">
        something broke <span className="italic text-accent">mid-flight.</span>
      </h1>
      <p className="mt-4 max-w-md font-sans text-sm leading-[1.8] text-zinc-400">
        The console hit an unexpected error. A retry usually re-establishes the link.
      </p>
      {error.digest && (
        <p className="mt-4 text-[9px] tracking-[0.3em] text-zinc-600">REF · {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-md bg-white px-5 py-2.5 text-[11px] font-semibold tracking-[0.25em] text-black transition-[background-color,transform] hover:bg-zinc-200 active:scale-[0.98]"
      >
        RETRY
      </button>
    </div>
  )
}
