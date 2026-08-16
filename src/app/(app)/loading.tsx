// Route-level loading UI for every (app) sector — Next.js shows this the
// moment a navigation commits, so transitions into the heavy client pages
// never feel frozen. Server component: no client JS, no heavy imports; the
// pulse rides Tailwind's stock animate-pulse.
export default function AppLoading() {
  return (
    <div
      role="status"
      className="flex min-h-[calc(100vh-var(--nav-topbar-h))] items-center justify-center font-mono text-zinc-100"
    >
      <div className="flex animate-pulse items-center gap-2.5 text-[10px] tracking-[0.4em] text-zinc-500">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-accent"
          style={{ boxShadow: '0 0 8px rgb(var(--accent-rgb) / 0.6)' }}
        />
        LOADING
      </div>
    </div>
  )
}
