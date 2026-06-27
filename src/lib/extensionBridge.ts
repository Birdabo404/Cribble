// Wire-format message types (CRIBBLE_WEB_*, CRIBBLE_EXTENSION_*) must stay
// in sync with cribble-extension/content/cribble-bridge.js.

export const IDENTITY_MS = 3500
export const FORCE_SYNC_MS = 8000

export type ExtensionOutgoingMessage =
  | { type: 'CRIBBLE_WEB_REQUEST_ID' }
  | { type: 'CRIBBLE_WEB_FORCE_SYNC' }
  | {
      type: 'CRIBBLE_DEVICE_REGISTERED'
      success: boolean
      deviceUuid: string
      userId: number
    }

interface ExtensionDetectedMessage {
  type: 'CRIBBLE_EXTENSION_DETECTED'
  uuid?: unknown
  isRegistered?: unknown
  userId?: unknown
  queueSize?: unknown
}

interface SyncCompleteMessage {
  type: 'CRIBBLE_SYNC_COMPLETE'
  success?: unknown
}

interface ExtensionErrorMessage {
  type: 'CRIBBLE_EXTENSION_ERROR'
  error?: unknown
}

interface PointsEarnedMessage {
  type: 'CRIBBLE_POINTS_EARNED'
}

export type ExtensionIncomingMessage =
  | ExtensionDetectedMessage
  | SyncCompleteMessage
  | ExtensionErrorMessage
  | PointsEarnedMessage

export interface ExtensionIdentity {
  deviceUuid: string
  isRegistered: boolean
  userId: number | null
  queueSize?: number
}

export type ExtensionForceSyncSource =
  | 'extension'
  | 'timeout'
  | 'error'
  | 'unsupported'

export interface ExtensionForceSyncResult {
  success: boolean
  source: ExtensionForceSyncSource
}

interface PostMessageRpcOptions<T> {
  send: ExtensionOutgoingMessage
  timeoutMs: number
  onTimeout: () => T
  onMessage: (msg: ExtensionIncomingMessage) => T | undefined
  onPostError?: (err: unknown) => T
}

function postMessageRpc<T>(opts: PostMessageRpcOptions<T>): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.resolve(opts.onTimeout())
  }

  return new Promise<T>((resolve) => {
    let settled = false

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handle)
    }

    const settle = (value: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const handle = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as ExtensionIncomingMessage | undefined
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
      const result = opts.onMessage(data)
      if (result !== undefined) settle(result)
    }

    const timeoutId = window.setTimeout(() => {
      settle(opts.onTimeout())
    }, opts.timeoutMs)

    window.addEventListener('message', handle)

    try {
      window.postMessage(opts.send, window.location.origin)
    } catch (err) {
      const fallback = opts.onPostError ? opts.onPostError(err) : opts.onTimeout()
      settle(fallback)
    }
  })
}

export function requestExtensionIdentity(): Promise<ExtensionIdentity | null> {
  return postMessageRpc<ExtensionIdentity | null>({
    send: { type: 'CRIBBLE_WEB_REQUEST_ID' },
    timeoutMs: IDENTITY_MS,
    onTimeout: () => null,
    onPostError: () => null,
    onMessage: (msg) => {
      switch (msg.type) {
        case 'CRIBBLE_EXTENSION_DETECTED': {
          if (typeof msg.uuid !== 'string' || !msg.uuid) return undefined
          return {
            deviceUuid: msg.uuid,
            isRegistered: !!msg.isRegistered,
            userId: typeof msg.userId === 'number' ? msg.userId : null,
            queueSize: typeof msg.queueSize === 'number' ? msg.queueSize : undefined
          }
        }
        case 'CRIBBLE_EXTENSION_ERROR':
          return null
        case 'CRIBBLE_SYNC_COMPLETE':
        case 'CRIBBLE_POINTS_EARNED':
          return undefined
      }
    }
  })
}

export function forceExtensionSync(): Promise<ExtensionForceSyncResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ success: false, source: 'unsupported' })
  }
  return postMessageRpc<ExtensionForceSyncResult>({
    send: { type: 'CRIBBLE_WEB_FORCE_SYNC' },
    timeoutMs: FORCE_SYNC_MS,
    onTimeout: () => ({ success: false, source: 'timeout' }),
    onPostError: () => ({ success: false, source: 'error' }),
    onMessage: (msg) => {
      switch (msg.type) {
        case 'CRIBBLE_SYNC_COMPLETE':
          return { success: !!msg.success, source: 'extension' }
        case 'CRIBBLE_EXTENSION_ERROR':
          return { success: false, source: 'error' }
        case 'CRIBBLE_EXTENSION_DETECTED':
        case 'CRIBBLE_POINTS_EARNED':
          return undefined
      }
    }
  })
}

// Fire-and-forget: flips the extension popup to "linked" without waiting for
// its next heartbeat.
export function notifyDeviceRegistered(params: {
  deviceUuid: string
  userId: number
}): void {
  if (typeof window === 'undefined') return
  const payload: ExtensionOutgoingMessage = {
    type: 'CRIBBLE_DEVICE_REGISTERED',
    success: true,
    deviceUuid: params.deviceUuid,
    userId: params.userId
  }
  try {
    window.postMessage(payload, window.location.origin)
  } catch {}
}
