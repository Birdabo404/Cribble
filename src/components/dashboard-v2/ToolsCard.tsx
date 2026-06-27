import type { ToolRow } from '@/types/dashboard'

export function ToolsCard({ tools }: { tools: ToolRow[] }) {
  return (
    <section className="col-span-12 lg:col-span-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm p-5">
      <div className="text-[10px] tracking-[0.4em] text-zinc-300">TOP TOOLS</div>
      <div className="text-xs text-zinc-400 mt-1">By contribution to score</div>

      {tools.length === 0 ? (
        <div className="mt-6 text-xs text-zinc-500">
          No AI tool usage detected yet. Open ChatGPT, Claude, or Cursor with the extension installed.
        </div>
      ) : (
        <ul className="mt-5 space-y-3.5">
          {tools.map((t, i) => (
            <li key={t.name}>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[#02fe01]/70 w-4 text-right tabular-nums">{i + 1}</span>
                  <span className="text-zinc-100">{t.name}</span>
                </div>
                <span className="text-zinc-400 tabular-nums">{t.percent}%</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-zinc-900 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#02fe01]/65 to-[#02fe01]"
                  style={{ width: `${Math.max(2, t.percent)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
