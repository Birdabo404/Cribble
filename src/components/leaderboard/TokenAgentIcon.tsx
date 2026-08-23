import { ToolIcon } from '@/components/leaderboard/icons'
import { tokenAgentLabel } from '@/lib/tokenLeaderboard'

const AGENT_ACCENTS: Record<string, { color: string; edge: string; surface: string }> = {
  Codex: {
    color: 'rgb(var(--z100))',
    edge: 'rgb(16 163 127 / 0.38)',
    surface: 'linear-gradient(145deg, rgb(16 163 127 / 0.18), rgb(var(--lb-panel-edge) / 0.04))'
  },
  'Claude Code': {
    color: '#D97757',
    edge: 'rgb(217 119 87 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(217 119 87 / 0.17), rgb(var(--lb-panel-edge) / 0.04))'
  },
  Cursor: {
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.2)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.025))'
  },
  'Gemini CLI': {
    color: '#8B9DFF',
    edge: 'rgb(139 157 255 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(33 123 254 / 0.16), rgb(189 153 254 / 0.1))'
  },
  'GitHub Copilot': {
    color: 'rgb(var(--z100))',
    edge: 'rgb(168 85 247 / 0.34)',
    surface: 'linear-gradient(145deg, rgb(168 85 247 / 0.14), rgb(var(--lb-panel-edge) / 0.035))'
  }
}

export function TokenAgentIcon({
  agent,
  size = 18,
  className = ''
}: {
  agent: string | null
  size?: number
  className?: string
}) {
  const label = tokenAgentLabel(agent)
  const accent = label ? AGENT_ACCENTS[label] : null
  const box = Math.max(30, size + 16)

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[10px] ${className}`}
      style={{
        width: box,
        height: box,
        color: accent?.color ?? 'rgb(var(--z500))',
        border: `1px solid ${accent?.edge ?? 'rgb(var(--lb-panel-edge) / 0.12)'}`,
        background: accent?.surface ?? 'rgb(var(--lb-panel-edge) / 0.035)'
      }}
      title={label ?? 'Agent not reported'}
      aria-label={label ?? 'Agent not reported'}
    >
      {label ? <ToolIcon name={label} size={size} /> : <span className="text-xs">?</span>}
    </span>
  )
}
