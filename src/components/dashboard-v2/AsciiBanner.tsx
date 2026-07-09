import { ACCENT, accentA } from './format'

// "DASHBOARD" rendered in ANSI Shadow block characters, matching the leaderboard ASCII.
const ASCII_DASHBOARD = String.raw`██████╗  █████╗ ███████╗██╗  ██╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ 
██╔══██╗██╔══██╗██╔════╝██║  ██║██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ██║███████║███████╗███████║██████╔╝██║   ██║███████║██████╔╝██║  ██║
██║  ██║██╔══██║╚════██║██╔══██║██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║
██████╔╝██║  ██║███████║██║  ██║██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ `

export function AsciiBanner({ username }: { username: string }) {
  return (
    <section className="mt-10 flex flex-col items-center gap-2">
      <div className="w-full overflow-x-auto py-1">
        <pre
          aria-label="DASHBOARD"
          className="whitespace-pre leading-[0.9] font-mono text-center mx-auto"
          style={{
            fontSize: 'clamp(4.5px, 0.78vw, 9.5px)',
            color: ACCENT,
            textShadow: `0 0 8px ${accentA(0.33)}, 0 0 22px ${accentA(0.15)}`,
            letterSpacing: '-0.02em'
          }}
        >
          {ASCII_DASHBOARD}
        </pre>
      </div>
      <p className="text-[10px] tracking-[0.3em] text-zinc-600 text-center">
        <span style={{ color: `${accentA(0.8)}` }}>{'// '}</span>
        pilot console
        <span className="mx-2 text-zinc-800">·</span>
        @{username || 'user'}
        <span className="mx-2 text-zinc-800">·</span>
        live mode
      </p>
    </section>
  )
}
