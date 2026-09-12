import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_AGENT_PROGRESS,
  EMPTY_EXTENSION_PROGRESS,
  loadWelcomeProgress,
  saveWelcomeProgress,
  type WelcomeProgress
} from './welcomeProgress'

// vitest runs in node, so a Map stands in for sessionStorage. The
// parser only ever calls getItem/setItem/removeItem.
function installFakeWindow(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      }
    }
  })
  return store
}

const STORAGE_KEY = 'cribble.welcome.progress'

const SAVED: WelcomeProgress = {
  stage: 'extension',
  mode: 'solo',
  countMode: 'browser',
  role: 'developer',
  goal: 'build',
  topTools: ['chatgpt', 'claude'],
  agent: EMPTY_AGENT_PROGRESS,
  extension: {
    storeOpenedAt: 1_700_000_000_000,
    autoReconnects: 1,
    pinAcknowledged: true
  },
  fastResume: true,
  savedAt: 1_700_000_001_000
}

// sessionStorage is client-writable and older snapshots predate the
// extension fields, so the parse has to fill in the empty snapshot for
// anything missing or malformed rather than reject the whole resume —
// losing every answer over one bad field would restart the wizard.
describe('loadWelcomeProgress extension fields', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips the extension snapshot and fastResume through save/load', () => {
    saveWelcomeProgress(SAVED)
    expect(loadWelcomeProgress()).toEqual(SAVED)
  })

  it('fills the empty extension snapshot and fastResume=false for a pre-extension save', () => {
    const legacy: Record<string, unknown> = { ...SAVED }
    delete legacy.extension
    delete legacy.fastResume
    store.set(STORAGE_KEY, JSON.stringify(legacy))
    const loaded = loadWelcomeProgress()
    expect(loaded?.extension).toEqual(EMPTY_EXTENSION_PROGRESS)
    expect(loaded?.fastResume).toBe(false)
    expect(loaded?.stage).toBe('extension')
  })

  it('treats a non-object extension field as the empty snapshot', () => {
    store.set(STORAGE_KEY, JSON.stringify({ ...SAVED, extension: 'pinned' }))
    expect(loadWelcomeProgress()?.extension).toEqual(EMPTY_EXTENSION_PROGRESS)
  })

  it('accepts storeOpenedAt only as a finite number', () => {
    const read = (storeOpenedAt: unknown) => {
      store.set(
        STORAGE_KEY,
        JSON.stringify({ ...SAVED, extension: { ...SAVED.extension, storeOpenedAt } })
      )
      return loadWelcomeProgress()?.extension.storeOpenedAt
    }
    expect(read(1234)).toBe(1234)
    expect(read(null)).toBeNull()
    expect(read('1234')).toBeNull()
    expect(read(undefined)).toBeNull()
  })

  it('accepts autoReconnects only as a whole non-negative number', () => {
    const read = (autoReconnects: unknown) => {
      store.set(
        STORAGE_KEY,
        JSON.stringify({ ...SAVED, extension: { ...SAVED.extension, autoReconnects } })
      )
      return loadWelcomeProgress()?.extension.autoReconnects
    }
    expect(read(0)).toBe(0)
    expect(read(1)).toBe(1)
    expect(read(-1)).toBe(0)
    expect(read(1.5)).toBe(0)
    expect(read('1')).toBe(0)
    expect(read(undefined)).toBe(0)
  })

  it('reads pinAcknowledged and fastResume as strict booleans', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        ...SAVED,
        fastResume: 'yes',
        extension: { ...SAVED.extension, pinAcknowledged: 1 }
      })
    )
    const loaded = loadWelcomeProgress()
    expect(loaded?.fastResume).toBe(false)
    expect(loaded?.extension.pinAcknowledged).toBe(false)
  })
})
