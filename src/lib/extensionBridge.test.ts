import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal window polyfill — vitest's default 'node' environment has no DOM,
// so we wire up just enough to exercise extensionBridge's postMessage RPC.
type MessageListener = (event: { origin: string; data: unknown }) => void

interface FakeWindow {
  location: { origin: string }
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  addEventListener(type: 'message', listener: MessageListener): void
  removeEventListener(type: 'message', listener: MessageListener): void
  postMessage(payload: unknown, origin: string): void
  __sentPayloads: unknown[]
  __listeners: Set<MessageListener>
  __reply: (data: unknown) => void
}

function installFakeWindow(): FakeWindow {
  const listeners = new Set<MessageListener>()
  const sent: unknown[] = []
  const fake: FakeWindow = {
    location: { origin: 'http://localhost' },
    // Delegate at call time so vi.useFakeTimers() (installed in beforeEach
    // AFTER this polyfill) is honored by the bridge.
    setTimeout: ((fn: () => void, ms?: number) =>
      globalThis.setTimeout(fn, ms)) as unknown as typeof setTimeout,
    clearTimeout: ((id: ReturnType<typeof setTimeout>) =>
      globalThis.clearTimeout(id)) as unknown as typeof clearTimeout,
    addEventListener(_, listener) {
      listeners.add(listener)
    },
    removeEventListener(_, listener) {
      listeners.delete(listener)
    },
    postMessage(payload) {
      sent.push(payload)
    },
    __sentPayloads: sent,
    __listeners: listeners,
    __reply(data) {
      for (const l of Array.from(listeners)) {
        l({ origin: 'http://localhost', data })
      }
    }
  }
  ;(globalThis as unknown as { window: FakeWindow }).window = fake
  return fake
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window
}

describe('extensionBridge wire contract', () => {
  let fake: FakeWindow

  beforeEach(() => {
    fake = installFakeWindow()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    uninstallWindow()
    vi.resetModules()
  })

  it('requestExtensionIdentity emits CRIBBLE_WEB_REQUEST_ID and parses CRIBBLE_EXTENSION_DETECTED', async () => {
    const { requestExtensionIdentity } = await import('./extensionBridge')

    const promise = requestExtensionIdentity()

    expect(fake.__sentPayloads).toEqual([{ type: 'CRIBBLE_WEB_REQUEST_ID' }])

    fake.__reply({
      type: 'CRIBBLE_EXTENSION_DETECTED',
      uuid: 'device-abc',
      isRegistered: true,
      userId: 42,
      queueSize: 3,
      hasSyncToken: true
    })

    await expect(promise).resolves.toEqual({
      deviceUuid: 'device-abc',
      isRegistered: true,
      userId: 42,
      queueSize: 3,
      hasSyncToken: true
    })
    expect(fake.__listeners.size).toBe(0)
  })

  it('requestExtensionIdentity resolves null on CRIBBLE_EXTENSION_ERROR', async () => {
    const { requestExtensionIdentity } = await import('./extensionBridge')
    const promise = requestExtensionIdentity()
    fake.__reply({ type: 'CRIBBLE_EXTENSION_ERROR', error: 'boom' })
    await expect(promise).resolves.toBeNull()
    expect(fake.__listeners.size).toBe(0)
  })

  it('requestExtensionIdentity resolves null after IDENTITY_MS timeout (3500ms)', async () => {
    const { requestExtensionIdentity, IDENTITY_MS } = await import('./extensionBridge')
    expect(IDENTITY_MS).toBe(3500)
    const promise = requestExtensionIdentity()
    vi.advanceTimersByTime(IDENTITY_MS)
    await expect(promise).resolves.toBeNull()
    expect(fake.__listeners.size).toBe(0)
  })

  it('requestExtensionIdentity ignores unrelated messages until detection lands', async () => {
    const { requestExtensionIdentity } = await import('./extensionBridge')
    const promise = requestExtensionIdentity()

    fake.__reply({ type: 'CRIBBLE_POINTS_EARNED' })
    fake.__reply({ type: 'CRIBBLE_SYNC_COMPLETE', success: true })
    fake.__reply({ type: 'CRIBBLE_EXTENSION_DETECTED', uuid: 'dev-1' })

    await expect(promise).resolves.toEqual({
      deviceUuid: 'dev-1',
      isRegistered: false,
      userId: null,
      queueSize: undefined,
      hasSyncToken: false
    })
  })

  it('forceExtensionSync emits CRIBBLE_WEB_FORCE_SYNC and resolves on CRIBBLE_SYNC_COMPLETE', async () => {
    const { forceExtensionSync } = await import('./extensionBridge')
    const promise = forceExtensionSync()

    expect(fake.__sentPayloads).toEqual([{ type: 'CRIBBLE_WEB_FORCE_SYNC' }])

    fake.__reply({ type: 'CRIBBLE_SYNC_COMPLETE', success: true })

    await expect(promise).resolves.toEqual({
      success: true,
      source: 'extension'
    })
    expect(fake.__listeners.size).toBe(0)
  })

  it('forceExtensionSync reports timeout source after FORCE_SYNC_MS (8000ms)', async () => {
    const { forceExtensionSync, FORCE_SYNC_MS } = await import('./extensionBridge')
    expect(FORCE_SYNC_MS).toBe(8000)
    const promise = forceExtensionSync()
    vi.advanceTimersByTime(FORCE_SYNC_MS)
    await expect(promise).resolves.toEqual({
      success: false,
      source: 'timeout'
    })
  })

  it('forceExtensionSync reports error source on CRIBBLE_EXTENSION_ERROR', async () => {
    const { forceExtensionSync } = await import('./extensionBridge')
    const promise = forceExtensionSync()
    fake.__reply({ type: 'CRIBBLE_EXTENSION_ERROR' })
    await expect(promise).resolves.toEqual({
      success: false,
      source: 'error'
    })
  })

  it('notifyDeviceRegistered posts CRIBBLE_DEVICE_REGISTERED with deviceUuid + userId', async () => {
    const { notifyDeviceRegistered } = await import('./extensionBridge')
    notifyDeviceRegistered({ deviceUuid: 'dev-xyz', userId: 9 })
    expect(fake.__sentPayloads).toEqual([
      {
        type: 'CRIBBLE_DEVICE_REGISTERED',
        success: true,
        deviceUuid: 'dev-xyz',
        userId: 9
      }
    ])
  })

  it('notifyDeviceRegistered forwards the issued sync token when present', async () => {
    const { notifyDeviceRegistered } = await import('./extensionBridge')
    notifyDeviceRegistered({ deviceUuid: 'dev-xyz', userId: 9, syncToken: 'tok-123' })
    expect(fake.__sentPayloads).toEqual([
      {
        type: 'CRIBBLE_DEVICE_REGISTERED',
        success: true,
        deviceUuid: 'dev-xyz',
        userId: 9,
        syncToken: 'tok-123'
      }
    ])
  })

  it('settles only once even when multiple matching messages arrive', async () => {
    const { forceExtensionSync } = await import('./extensionBridge')
    const promise = forceExtensionSync()
    fake.__reply({ type: 'CRIBBLE_SYNC_COMPLETE', success: true })
    fake.__reply({ type: 'CRIBBLE_SYNC_COMPLETE', success: false })
    await expect(promise).resolves.toEqual({
      success: true,
      source: 'extension'
    })
    expect(fake.__listeners.size).toBe(0)
  })

  it('ignores messages from a different origin', async () => {
    const { requestExtensionIdentity, IDENTITY_MS } = await import('./extensionBridge')
    const promise = requestExtensionIdentity()
    for (const l of Array.from(fake.__listeners)) {
      l({ origin: 'http://evil.example', data: { type: 'CRIBBLE_EXTENSION_DETECTED', uuid: 'attacker' } })
    }
    vi.advanceTimersByTime(IDENTITY_MS)
    await expect(promise).resolves.toBeNull()
  })
})
