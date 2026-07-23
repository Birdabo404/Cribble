import { animDelay } from '@/components/dashboard-v3/anim'
import { ACCENT, accentA } from './format'

// "DASHBOARD" rendered in ANSI Shadow block characters, matching the leaderboard ASCII.
const ASCII_DASHBOARD = String.raw`██████╗  █████╗ ███████╗██╗  ██╗██████╗  ██████╗  █████╗ ██████╗ ██████╗ 
██╔══██╗██╔══██╗██╔════╝██║  ██║██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ██║███████║███████╗███████║██████╔╝██║   ██║███████║██████╔╝██║  ██║
██║  ██║██╔══██║╚════██║██╔══██║██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║
██████╔╝██║  ██║███████║██║  ██║██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝
╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ `

export function AsciiBanner({ username }: { username: string }) {
  // Instrument readout under the wordmark — dossier stamp format.
  const stamp = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()

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
      {/* The leading slashes are the one green echo outside the wordmark. */}
      <p
        className="anim-rise font-data text-[10px] tracking-[0.22em] text-zinc-500 text-center"
        style={animDelay(180)}
      >
        <span style={{ color: `${accentA(0.8)}` }}>{'// '}</span>
        PILOT CONSOLE
        <span className="mx-2 text-zinc-700" aria-hidden>·····</span>
        @{username || 'user'}
        {/* the date + live stamps drop below sm so the readout stays one line */}
        <span className="hidden sm:inline">
          <span className="mx-2 text-zinc-700" aria-hidden>·····</span>
          {stamp}
          <span className="mx-2 text-zinc-700" aria-hidden>·····</span>
          LIVE
        </span>
      </p>
    </section>
  )
}
