import { ACCENT, accentA } from './format'

export function LoadingScreen() {
  return (
    <div className="dossier-canvas min-h-screen bg-black text-zinc-100 font-mono flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.4em] text-zinc-500">
          <span
            className="loading-dot h-1.5 w-1.5 rounded-full"
            style={{
              background: ACCENT,
              boxShadow: `0 0 8px ${accentA(0.6)}`
            }}
          />
          SYNCING TELEMETRY
        </div>
        <div className="h-px w-32 overflow-hidden bg-zinc-900">
          <div
            className="loading-dash h-full w-1/3"
            style={{
              background: ACCENT,
              boxShadow: `0 0 6px ${accentA(0.6)}`
            }}
          />
        </div>
      </div>
      <style jsx>{`
        .loading-dot {
          animation: dot-pulse 1.4s ease-in-out infinite;
        }
        .loading-dash {
          animation: dash-slide 1.4s ease-in-out infinite;
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes dash-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}
