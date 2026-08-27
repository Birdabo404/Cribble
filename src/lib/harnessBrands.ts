export interface HarnessBrand {
  label: string
  color: string
  edge: string
  surface: string
  imageSrc?: string
}

const HARNESS_BRANDS: Record<string, HarnessBrand> = {
  Codex: {
    label: 'Codex',
    color: 'rgb(var(--z100))',
    edge: 'rgb(16 163 127 / 0.38)',
    surface: 'linear-gradient(145deg, rgb(16 163 127 / 0.18), rgb(var(--lb-panel-edge) / 0.04))'
  },
  'Claude Code': {
    label: 'Claude Code',
    color: '#D97757',
    edge: 'rgb(217 119 87 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(217 119 87 / 0.17), rgb(var(--lb-panel-edge) / 0.04))'
  },
  Cursor: {
    label: 'Cursor',
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.2)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.025))'
  },
  'Gemini CLI': {
    label: 'Gemini CLI',
    color: '#8B9DFF',
    edge: 'rgb(139 157 255 / 0.4)',
    surface: 'linear-gradient(145deg, rgb(33 123 254 / 0.16), rgb(189 153 254 / 0.1))'
  },
  'GitHub Copilot': {
    label: 'GitHub Copilot',
    color: 'rgb(var(--z100))',
    edge: 'rgb(168 85 247 / 0.34)',
    surface: 'linear-gradient(145deg, rgb(168 85 247 / 0.14), rgb(var(--lb-panel-edge) / 0.035))'
  },
  Hermes: {
    label: 'Hermes',
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.24)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.14), rgb(var(--lb-panel-edge) / 0.03))',
    imageSrc: '/agents/hermes.png'
  },
  Pi: {
    label: 'Pi',
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.24)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.03))',
    imageSrc: '/agents/pi.svg'
  },
  OpenCode: {
    label: 'OpenCode',
    color: 'rgb(var(--z100))',
    edge: 'rgb(var(--lb-panel-edge) / 0.24)',
    surface: 'linear-gradient(145deg, rgb(var(--lb-panel-edge) / 0.12), rgb(var(--lb-panel-edge) / 0.03))',
    imageSrc: '/agents/opencode.svg'
  }
}

export function harnessBrandForLabel(label: string): HarnessBrand | null {
  return HARNESS_BRANDS[label] ?? null
}
