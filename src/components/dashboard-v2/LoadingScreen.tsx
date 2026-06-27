import { HACKER_GREEN } from './format'

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.4em] text-zinc-500">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: HACKER_GREEN,
              boxShadow: `0 0 8px ${HACKER_GREEN}99`,
              animation: 'pulse 1.4s ease-in-out infinite'
            }}
          />
          SYNCING TELEMETRY
        </div>
        <div className="h-px w-32 overflow-hidden bg-zinc-900">
          <div
            className="h-full w-1/3"
            style={{
              background: HACKER_GREEN,
              boxShadow: `0 0 6px ${HACKER_GREEN}99`,
              animation: 'dash-slide 1.4s ease-in-out infinite'
            }}
          />
        </div>
      </div>
      <style jsx>{`
        @keyframes dash-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}
