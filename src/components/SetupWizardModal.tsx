import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'

interface SetupWizardModalProps {
  isOpen: boolean
  onClose: () => void
  userId: number
  onSetupComplete: (deviceUuid: string) => void
}

type WizardStep = 'install' | 'connect' | 'verify' | 'complete'

interface DeviceInfo {
  userAgent: string
  browserName: string
  browserVersion: string
  os: string
  deviceName: string
}

interface VerificationState {
  status: 'pending' | 'success' | 'failed'
  attempt: number
  maxAttempts: number
}

export default function SetupWizardModal({
  isOpen,
  onClose,
  userId,
  onSetupComplete
}: SetupWizardModalProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('install')
  const [deviceUuid, setDeviceUuid] = useState('')
  const [manualDeviceId, setManualDeviceId] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [glitching, setGlitching] = useState(false)
  const [verificationState, setVerificationState] = useState<VerificationState>({
    status: 'pending',
    attempt: 0,
    maxAttempts: 3
  })

  const steps: WizardStep[] = ['install', 'connect', 'verify', 'complete']
  const currentStepIndex = steps.indexOf(currentStep)

  useEffect(() => {
    if (isOpen) {
      setDeviceUuid('')
      setManualDeviceId('')
      setCurrentStep('install')
      setConnectionError('')
      setVerificationState({ status: 'pending', attempt: 0, maxAttempts: 3 })
    }
  }, [isOpen])

  // Random glitch trigger
  useEffect(() => {
    if (!isOpen) return
    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        setGlitching(true)
        setTimeout(() => setGlitching(false), 120)
      }
    }, 2800)
    return () => clearInterval(glitchInterval)
  }, [isOpen])

  const parseUserAgent = (userAgent: string): DeviceInfo => {
    const browserRegex = /(Chrome|Firefox|Safari|Edge)\/(\d+\.\d+)/i
    const osRegex = /(Windows|Mac|Linux|Android|iOS)/i
    const browserMatch = userAgent.match(browserRegex)
    const osMatch = userAgent.match(osRegex)
    const browserName = browserMatch ? browserMatch[1] : 'Unknown'
    const browserVersion = browserMatch ? browserMatch[2] : '0.0'
    const os = osMatch ? osMatch[1] : 'Unknown'
    return {
      userAgent,
      browserName,
      browserVersion,
      os,
      deviceName: `${browserName} ${browserVersion} on ${os}`
    }
  }

  const handleConnectExtension = async () => {
    setIsConnecting(true)
    setConnectionError('')

    if (!manualDeviceId.trim()) {
      setConnectionError('Device ID required')
      setIsConnecting(false)
      return
    }

    try {
      const deviceInfo = parseUserAgent(navigator.userAgent)
      const finalDeviceUuid = manualDeviceId.trim()

      const response = await fetch('/api/extension/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceUuid: finalDeviceUuid,
          userId,
          events: [],
          batchId: uuidv4(),
          deviceInfo
        })
      })

      if (response.ok) {
        setDeviceUuid(finalDeviceUuid)
        window.postMessage({
          type: 'CRIBBLE_DEVICE_REGISTERED',
          deviceUuid: finalDeviceUuid,
          userId: userId,
          success: true
        }, window.location.origin)

        setCurrentStep('verify')
        setTimeout(() => verifyConnection(finalDeviceUuid), 5000)
      } else {
        const error = await response.json()
        setConnectionError(error.error || 'Connection failed')
      }
    } catch {
      setConnectionError('Network error')
    } finally {
      setIsConnecting(false)
    }
  }

  const verifyConnection = async (uuidOverride?: string) => {
    const targetUuid = uuidOverride ?? deviceUuid

    if (!targetUuid || targetUuid.trim() === '') {
      setVerificationState(prev => ({ ...prev, status: 'failed', attempt: prev.attempt + 1 }))
      setConnectionError('Device UUID required')
      return
    }

    setVerificationState(prev => ({ ...prev, attempt: prev.attempt + 1 }))

    try {
      const response = await fetch(`/api/device/verify?deviceUuid=${encodeURIComponent(targetUuid)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (response.ok) {
        const result = await response.json()

        if (result.verified || result.isActive) {
          setVerificationState(prev => ({ ...prev, status: 'success' }))
          setTimeout(() => {
            setCurrentStep('complete')
            setTimeout(() => {
              onSetupComplete(targetUuid)
              onClose()
            }, 2000)
          }, 1000)
        } else {
          setVerificationState(prev => {
            if (prev.attempt < 2) {
              setTimeout(() => verifyConnection(targetUuid), 3000)
              return { ...prev, status: 'pending' }
            }
            return { ...prev, status: 'failed' }
          })
          if (verificationState.attempt >= 2) {
            setConnectionError(result.message || 'Device not active')
          }
        }
      } else {
        const error = await response.json().catch(() => ({}))
        setVerificationState(prev => ({ ...prev, status: 'failed' }))
        setConnectionError(error.error || 'Verification failed')
      }
    } catch {
      setVerificationState(prev => ({ ...prev, status: 'failed' }))
      setConnectionError('Network error')
    }
  }

  if (!isOpen) return null

  const stepLabels = ['INSTALL', 'CONNECT', 'VERIFY', 'DONE']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95">
      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'repeating-linear-gradient(0deg, rgb(var(--accent-rgb)/0.015) 0px, transparent 1px, transparent 4px)',
      }} />

      <div className={`relative w-full max-w-md transition-all ${glitching ? 'translate-x-[1px] opacity-95' : ''}`}>
        {/* Green outer glow */}
        <div className="absolute -inset-px rounded-lg bg-accent/20 blur-md pointer-events-none" />
        <div className="absolute -inset-[2px] rounded-lg bg-accent/5 blur-xl pointer-events-none" />

        <div className="relative bg-[var(--panel)] border border-accent/40 rounded-lg overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-accent/20">
            <div className="flex items-center gap-3">
              {/* Blinking dot */}
              <div className="relative w-2 h-2">
                <div className="absolute inset-0 rounded-full bg-accent animate-ping opacity-60" />
                <div className="relative w-2 h-2 rounded-full bg-accent" />
              </div>
              <span className="font-mono text-sm font-bold text-accent tracking-[0.2em] uppercase">
                {currentStep === 'install' && 'Install Extension'}
                {currentStep === 'connect' && 'Connect Device'}
                {currentStep === 'verify' && 'Verifying...'}
                {currentStep === 'complete' && 'Setup Complete'}
              </span>
            </div>
            {currentStep !== 'complete' && (
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-accent transition-colors font-mono text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Step indicator — minimal dots */}
          <div className="flex items-center gap-0 border-b border-accent/10">
            {steps.map((step, idx) => (
              <div key={step} className="flex-1 relative">
                <div className={`h-[2px] transition-all duration-500 ${
                  idx <= currentStepIndex ? 'bg-accent' : 'bg-accent/10'
                }`} />
                <div className={`absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full transition-all ${
                  idx < currentStepIndex ? 'bg-accent' :
                  idx === currentStepIndex ? 'bg-accent shadow-[0_0_6px_var(--accent)]' :
                  'bg-accent/20'
                }`} />
              </div>
            ))}
          </div>

          {/* Step label row */}
          <div className="flex border-b border-accent/10">
            {steps.map((step, idx) => (
              <div key={step} className={`flex-1 text-center py-1.5 font-mono text-[9px] tracking-widest transition-colors ${
                idx === currentStepIndex ? 'text-accent' : 'text-accent/25'
              }`}>
                {stepLabels[idx]}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="p-6">

            {/* INSTALL */}
            {currentStep === 'install' && (
              <div className="space-y-5">
                <p className="text-gray-400 font-mono text-xs leading-relaxed">
                  Download and install the browser extension to start tracking your AI usage across platforms.
                </p>

                <div className="space-y-1.5 text-[11px] font-mono text-gray-500">
                  <div className="flex gap-3">
                    <span className="text-accent/60">01</span>
                    <span>Download and unzip from GitHub</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent/60">02</span>
                    <span>Open <span className="text-accent/70">chrome://extensions</span></span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent/60">03</span>
                    <span>Enable "Developer mode" → Load unpacked</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent/60">04</span>
                    <span>Select the <span className="text-accent/70">cribble-extension</span> folder</span>
                  </div>
                </div>

                <a
                  href="https://github.com/Birdabo404/Cribble"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full border border-accent/30 hover:border-accent/70 hover:bg-accent/5 px-4 py-3 rounded font-mono text-sm text-accent transition-all group"
                >
                  <span>github.com/Birdabo404/Cribble</span>
                  <span className="text-accent/40 group-hover:text-accent transition-colors">↗</span>
                </a>

                <button
                  onClick={() => setCurrentStep('connect')}
                  className="w-full bg-accent hover:bg-accent/90 text-black px-4 py-3 rounded font-mono text-sm font-bold tracking-widest transition-all active:scale-[0.98]"
                >
                  INSTALLED → NEXT
                </button>
              </div>
            )}

            {/* CONNECT */}
            {currentStep === 'connect' && (
              <div className="space-y-5">
                <p className="text-gray-400 font-mono text-xs leading-relaxed">
                  Open the Cribble extension popup, copy your Device ID, and paste it below.
                </p>

                <div className="space-y-1.5 text-[11px] font-mono text-gray-500">
                  <div className="flex gap-3">
                    <span className="text-accent/60">01</span>
                    <span>Click the Cribble extension icon in toolbar</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent/60">02</span>
                    <span>Find and copy your Device ID</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent/60">03</span>
                    <span>Paste it in the field below</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-accent/50 mb-1.5 tracking-widest uppercase">
                    Device ID
                  </label>
                  <input
                    type="text"
                    value={manualDeviceId}
                    onChange={(e) => setManualDeviceId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full bg-black border border-accent/25 focus:border-accent/70 rounded px-3 py-3 text-accent font-mono text-xs placeholder-gray-700 focus:outline-none transition-all"
                    style={{ letterSpacing: '0.05em' }}
                  />
                </div>

                {connectionError && (
                  <div className="border border-red-500/30 bg-red-500/5 rounded px-3 py-2">
                    <span className="text-red-400 font-mono text-xs">{connectionError}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentStep('install')}
                    className="px-4 py-3 border border-accent/20 text-accent/50 hover:text-accent/80 hover:border-accent/40 rounded font-mono text-xs transition-all"
                  >
                    ← BACK
                  </button>
                  <button
                    onClick={handleConnectExtension}
                    disabled={isConnecting || !manualDeviceId.trim()}
                    className="flex-1 bg-accent hover:bg-accent/90 disabled:bg-accent/20 disabled:text-black/40 text-black px-4 py-3 rounded font-mono text-sm font-bold tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {isConnecting ? (
                      <>
                        <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                        CONNECTING
                      </>
                    ) : 'CONNECT'}
                  </button>
                </div>
              </div>
            )}

            {/* VERIFY */}
            {currentStep === 'verify' && (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-4 py-4">
                  {/* Status orb */}
                  <div className={`relative w-16 h-16 rounded-full border flex items-center justify-center transition-all ${
                    verificationState.status === 'success'
                      ? 'border-accent/60 bg-accent/10'
                      : verificationState.status === 'failed'
                        ? 'border-red-500/50 bg-red-500/5'
                        : 'border-accent/30 bg-accent/5'
                  }`}>
                    {verificationState.status === 'pending' && (
                      <>
                        <div className="absolute inset-0 rounded-full border border-accent/20 animate-ping" />
                        <div className="w-3 h-3 rounded-full bg-accent/60 animate-pulse" />
                      </>
                    )}
                    {verificationState.status === 'success' && (
                      <div className="w-4 h-4 rounded-full bg-accent shadow-[0_0_16px_var(--accent)]" />
                    )}
                    {verificationState.status === 'failed' && (
                      <div className="w-4 h-4 rounded-full bg-red-500" />
                    )}
                  </div>

                  <div className={`font-mono text-sm font-bold tracking-wider ${
                    verificationState.status === 'success' ? 'text-accent' :
                    verificationState.status === 'failed' ? 'text-red-400' :
                    'text-accent/60'
                  }`}>
                    {verificationState.status === 'success' ? 'VERIFIED' :
                     verificationState.status === 'failed' ? 'FAILED' :
                     'CHECKING CONNECTION'}
                  </div>

                  {verificationState.status === 'pending' && (
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1 h-1 rounded-full bg-accent/50"
                          style={{ animation: `bounce 1s ${i * 0.2}s infinite` }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {verificationState.status === 'failed' && connectionError && (
                  <div className="border border-red-500/20 bg-red-500/5 rounded px-3 py-2 text-center">
                    <span className="text-red-400 font-mono text-xs">{connectionError}</span>
                  </div>
                )}

                {verificationState.status === 'failed' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setCurrentStep('connect')
                        setConnectionError('')
                        setVerificationState({ status: 'pending', attempt: 0, maxAttempts: 3 })
                      }}
                      className="px-4 py-3 border border-accent/20 text-accent/50 hover:text-accent/80 rounded font-mono text-xs transition-all"
                    >
                      ← BACK
                    </button>
                    <button
                      onClick={() => verifyConnection(deviceUuid)}
                      className="flex-1 border border-accent/40 hover:border-accent/70 hover:bg-accent/5 text-accent px-4 py-3 rounded font-mono text-sm font-bold tracking-widest transition-all"
                    >
                      RETRY
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* COMPLETE */}
            {currentStep === 'complete' && (
              <div className="space-y-5 py-2">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-full border border-accent/60 bg-accent/10 flex items-center justify-center shadow-[0_0_24px_rgb(var(--accent-rgb)/0.2)]">
                    <div className="w-5 h-5 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
                  </div>
                  <div className="text-accent font-mono text-sm font-bold tracking-widest">CONNECTED</div>
                </div>

                <div className="space-y-1.5">
                  {['Device registered', 'Connection verified', 'Tracking active'].map((item) => (
                    <div key={item} className="flex items-center gap-3 text-[11px] font-mono text-gray-400">
                      <div className="w-1 h-1 rounded-full bg-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="text-center text-[10px] font-mono text-gray-600 pt-2">
                  Closing in a moment...
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
