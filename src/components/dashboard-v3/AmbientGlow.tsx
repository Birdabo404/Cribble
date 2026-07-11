'use client'

/**
 * Ambient color field behind the dashboard: two slow-drifting accent orbs
 * plus a neutral wash. Light mode only — the `ambient-glow-field` class is
 * hidden in dark mode (see globals.css), where the backdrop stays pure black.
 */
export function AmbientGlow() {
  return (
    <div
      aria-hidden
      className="ambient-glow-field pointer-events-none fixed inset-0 overflow-hidden z-0"
    >
      {/* top wash — slightly lifts the upper page so glass edges read */}
      <div
        className="absolute inset-x-0 top-0 h-[55vh]"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--accent-rgb) / 0.04), transparent 70%)'
        }}
      />

      {/* primary accent orb — upper right */}
      <div
        className="ambient-orb-a absolute -top-[18%] right-[-12%] h-[58vh] w-[58vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--accent-rgb) / 0.09), rgb(var(--accent-rgb) / 0.03) 45%, transparent 70%)',
          filter: 'blur(60px)'
        }}
      />

      {/* secondary accent orb — lower left, dimmer */}
      <div
        className="ambient-orb-b absolute bottom-[-22%] left-[-14%] h-[64vh] w-[64vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--accent-rgb) / 0.06), rgb(var(--accent-rgb) / 0.02) 45%, transparent 70%)',
          filter: 'blur(70px)'
        }}
      />

      {/* neutral counter-glow — center, keeps mid-page from going flat */}
      <div
        className="absolute top-[30%] left-[22%] h-[46vh] w-[46vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgb(var(--star-rgb) / 0.05), transparent 65%)',
          filter: 'blur(80px)'
        }}
      />

      <style jsx>{`
        .ambient-orb-a {
          animation: ambient-drift-a 26s ease-in-out infinite alternate;
          will-change: transform;
        }
        .ambient-orb-b {
          animation: ambient-drift-b 34s ease-in-out infinite alternate;
          will-change: transform;
        }

        @keyframes ambient-drift-a {
          from {
            transform: translate3d(0, 0, 0) scale(1);
          }
          to {
            transform: translate3d(-6vw, 5vh, 0) scale(1.12);
          }
        }
        @keyframes ambient-drift-b {
          from {
            transform: translate3d(0, 0, 0) scale(1.08);
          }
          to {
            transform: translate3d(5vw, -5vh, 0) scale(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ambient-orb-a,
          .ambient-orb-b {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
