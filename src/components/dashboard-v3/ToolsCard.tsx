import { formatCompact, formatDuration } from '@/components/dashboard-v2/format'
import { animDelay } from './anim'
import { IconChip } from './DashIcons'
import { Panel, PanelHeader } from './Panel'
import type { ToolRow } from '@/types/dashboard'

// Rank #1 owns ember; the rest grade down through ice — the duotone reads
// "your main weapon vs the supporting stack" at a glance.
const ROW_BAR = [
  'bg-gradient-to-r from-ember/70 to-ember',
  'bg-ice/70',
  'bg-ice/45',
  'bg-ice/30',
  'bg-ice/20'
]
const MIX_SEG = ['bg-ember', 'bg-ice/80', 'bg-ice/55', 'bg-ice/35', 'bg-ice/20']

const grade = (map: string[], i: number) => map[Math.min(i, map.length - 1)]

export function ToolsCard({ tools }: { tools: ToolRow[] }) {
  return (
    <Panel className="col-span-12 lg:col-span-4 p-6">
      <PanelHeader
        title="TOP TOOLS"
        icon={<IconChip size={12} />}
        subtitle="By contribution to score"
      />

      {tools.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-800 p-4 text-xs leading-relaxed text-zinc-500">
          No AI tool usage detected yet. Open ChatGPT, Claude, or Cursor with the extension
          installed to start earning points.
        </div>
      ) : (
        <>
          {/* 100% composition bar — the whole tool mix in one strip */}
          <div
            className="anim-grow-x mt-4 flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
            style={animDelay(110)}
            aria-hidden
          >
            {tools.map((t, i) => (
              <span
                key={t.name}
                className={`h-full ${grade(MIX_SEG, i)}`}
                style={{ width: `${Math.max(1, t.percent)}%` }}
                title={`${t.name} · ${t.percent}%`}
              />
            ))}
          </div>

          <ul className="mt-5 space-y-4">
            {tools.map((t, i) => (
              <li key={t.name} className="anim-rise" style={animDelay(160 + i * 110)}>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`font-data w-4 text-right tabular-nums shrink-0 ${
                        i === 0 ? 'text-ember' : 'text-ice/60'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-zinc-100 truncate">{t.name}</span>
                  </div>
                  <span className="font-display text-zinc-300 font-semibold tabular-nums shrink-0">
                    {t.percent}%
                  </span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    className={`anim-grow-x h-full ${grade(ROW_BAR, i)}`}
                    style={{ width: `${Math.max(2, t.percent)}%`, ...animDelay(340 + i * 110) }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-3 pl-6 font-data text-[10px] text-zinc-500 tabular-nums">
                  <span>{formatCompact(t.visits)} visits</span>
                  <span className="text-zinc-800">·</span>
                  <span>{formatDuration(t.active_ms)} active</span>
                  <span className="text-zinc-800">·</span>
                  <span>{formatCompact(Math.round(t.score))} pts</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
