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
      setConnectionError('Please enter a device ID')
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
        setTimeout(() => verifyConnection(), 3000)
      } else {
        const error = await response.json()
        setConnectionError(error.error || 'Failed to connect device')
      }
    } catch (error) {
      setConnectionError('Network error occurred')
    } finally {
      setIsConnecting(false)
    }
  }

  const verifyConnection = async () => {
    try {
      const currentAttempt = verificationState.attempt + 1
      setVerificationState(prev => ({ ...prev, attempt: currentAttempt }))
      
      if (!deviceUuid || deviceUuid.trim() === '') {
        setVerificationState({ status: 'failed', attempt: currentAttempt, maxAttempts: 3 })
        setConnectionError('Device UUID is required')
        return
      }
      
      const response = await fetch(`/api/device/verify?deviceUuid=${encodeURIComponent(deviceUuid)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })

      if (response.ok) {
        const result = await response.json()
        
        if (result.verified || result.isActive) {
          setVerificationState({ status: 'success', attempt: currentAttempt, maxAttempts: 3 })
          setTimeout(() => {
            setCurrentStep('complete')
            setTimeout(() => {
              onSetupComplete(deviceUuid)
              onClose()
            }, 2000)
          }, 1000)
        } else {
          setVerificationState({ status: 'failed', attempt: currentAttempt, maxAttempts: 3 })
          setConnectionError(result.message || 'Device not active')
        }
      } else {
        const error = await response.json()
        setVerificationState({ status: 'failed', attempt: currentAttempt, maxAttempts: 3 })
        setConnectionError(error.error || 'Device verification failed')
      }
    } catch (error) {
      const currentAttempt = verificationState.attempt + 1
      setVerificationState({ status: 'failed', attempt: currentAttempt, maxAttempts: 3 })
      setConnectionError('Verification network error')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
      {/* CRT Scanlines */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="h-full w-full" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,255,255,0.03) 0px, transparent 1px, transparent 3px)',
        }}></div>
      </div>

      <div className="relative w-full max-w-lg">
        {/* Glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl"></div>
        
        <div className="relative bg-black border border-cyan-400/40 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="relative border-b border-cyan-400/30 bg-gradient-to-r from-gray-900 via-gray-900 to-gray-900">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-cyan-500/5"></div>
            <div className="relative flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
                  currentStep === 'complete' 
                    ? 'bg-green-500/20 border-green-400/40' 
                    : 'bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border-cyan-400/40'
                }`}>
                  <div className={`w-3 h-3 rounded-full ${
                    currentStep === 'complete' ? 'bg-green-400' : 'bg-cyan-400'
                  } ${currentStep === 'verify' ? 'animate-pulse' : ''}`}></div>
                </div>
                <div>
                  <h2 className="text-lg font-mono font-bold text-cyan-300 tracking-wider">
                    {currentStep === 'install' && 'INSTALL'}
                    {currentStep === 'connect' && 'CONNECT'}
                    {currentStep === 'verify' && 'VERIFYING'}
                    {currentStep === 'complete' && 'COMPLETE'}
                  </h2>
                  <p className="text-[10px] font-mono text-gray-500">SETUP WIZARD</p>
                </div>
              </div>
              {currentStep !== 'complete' && (
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg border border-gray-700 text-gray-500 hover:text-white hover:border-gray-500 transition-all flex items-center justify-center"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Progress Steps */}
          <div className="px-6 py-4 bg-gray-900/50 border-b border-gray-800/50">
            <div className="flex items-center justify-between">
              {steps.map((step, idx) => (
                <div key={step} className="flex items-center">
                  <div className={`
                    w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono text-sm font-bold transition-all
                    ${idx < currentStepIndex 
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' 
                      : idx === currentStepIndex 
                        ? 'bg-purple-500/20 border-purple-400 text-purple-300 animate-pulse' 
                        : 'bg-gray-800/50 border-gray-700 text-gray-600'}
                  `}>
                    {idx < currentStepIndex ? '✓' : idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={`w-12 sm:w-16 h-0.5 mx-2 transition-all ${
                      idx < currentStepIndex ? 'bg-cyan-400/60' : 'bg-gray-700'
                    }`}></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Install Step */}
            {currentStep === 'install' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-400/30 flex items-center justify-center mb-4">
                    <div className="w-6 h-6 rounded-full bg-cyan-400/20 border border-cyan-400/40"></div>
                  </div>
                  <p className="text-gray-400 font-mono text-sm">
                    Install the Cribble extension to start tracking your AI usage.
                  </p>
                </div>
                
                <a
                  href="https://github.com/Birdabo404/Cribble"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-3 w-full bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-700 hover:to-gray-800 border border-gray-700 hover:border-gray-600 text-white px-6 py-4 rounded-xl font-mono transition-all group"
                >
                  <span className="font-bold">Download from GitHub</span>
                  <span className="text-gray-500 group-hover:text-gray-400 transition-colors">→</span>
                </a>

                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4">
                  <div className="text-xs font-mono text-cyan-300/80 space-y-1">
                    <p>1. Download and unzip the extension</p>
                    <p>2. Open chrome://extensions in your browser</p>
                    <p>3. Enable "Developer mode" and click "Load unpacked"</p>
                    <p>4. Select the cribble-extension folder</p>
                  </div>
                </div>

                <button
                  onClick={() => setCurrentStep('connect')}
                  className="w-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-400/50 text-cyan-300 px-6 py-4 rounded-xl font-mono font-bold transition-all"
                >
                  EXTENSION INSTALLED
                </button>
              </div>
            )}

            {/* Connect Step */}
            {currentStep === 'connect' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-400/30 flex items-center justify-center mb-4">
                    <div className="w-6 h-6 rounded-full bg-purple-400/20 border border-purple-400/40"></div>
                  </div>
                  <p className="text-gray-400 font-mono text-sm">
                    Copy your Device ID from the extension and paste it below.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-gray-500 mb-2 uppercase tracking-wider">
                    Device ID
                  </label>
                  <input
                    type="text"
                    value={manualDeviceId}
                    onChange={(e) => setManualDeviceId(e.target.value)}
                    placeholder="e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                    className="w-full bg-gray-900/50 border border-gray-700 focus:border-cyan-400/60 rounded-xl px-4 py-4 text-cyan-300 font-mono text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-400/30 transition-all"
                  />
                </div>

                <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
                  <div className="text-xs font-mono text-purple-300/80 space-y-1">
                    <p>1. Click the Cribble extension icon</p>
                    <p>2. Find the "Device ID" field</p>
                    <p>3. Click "Copy" and paste it above</p>
                  </div>
                </div>

                {connectionError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <span className="text-red-300 font-mono text-sm">{connectionError}</span>
                  </div>
                )}

                <button
                  onClick={handleConnectExtension}
                  disabled={isConnecting || !manualDeviceId.trim()}
                  className="w-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-400/50 text-purple-300 px-6 py-4 rounded-xl font-mono font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></div>
                      <span>CONNECTING</span>
                    </>
                  ) : (
                    <span>CONNECT DEVICE</span>
                  )}
                </button>
              </div>
            )}

            {/* Verify Step */}
            {currentStep === 'verify' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-xl border flex items-center justify-center mb-4 transition-all ${
                    verificationState.status === 'success' 
                      ? 'bg-green-500/10 border-green-400/30' 
                      : verificationState.status === 'failed'
                        ? 'bg-red-500/10 border-red-400/30'
                        : 'bg-yellow-500/10 border-yellow-400/30'
                  }`}>
                    <div className={`w-4 h-4 rounded-full ${
                      verificationState.status === 'success' ? 'bg-green-400' :
                      verificationState.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'
                    }`}></div>
                  </div>
                  <p className={`font-mono text-sm ${
                    verificationState.status === 'success' ? 'text-green-400' :
                    verificationState.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                  }`}>
                    {verificationState.status === 'success' ? 'Connection verified' :
                     verificationState.status === 'failed' ? 'Verification failed' : 'Verifying connection...'}
                  </p>
                </div>

                {verificationState.status === 'pending' && (
                  <div className="flex justify-center">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div 
                          key={i}
                          className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        ></div>
                      ))}
                    </div>
                  </div>
                )}

                {verificationState.status === 'failed' && connectionError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <div className="text-red-300 font-mono text-sm text-center">{connectionError}</div>
                    {verificationState.attempt < verificationState.maxAttempts && (
                      <div className="text-gray-500 font-mono text-xs text-center mt-2">
                        Attempt {verificationState.attempt} of {verificationState.maxAttempts}
                      </div>
                    )}
                  </div>
                )}

                {verificationState.status === 'failed' && (
                  <button
                    onClick={verifyConnection}
                    className="w-full bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-400/40 text-yellow-300 px-6 py-4 rounded-xl font-mono font-bold transition-all"
                  >
                    RETRY
                  </button>
                )}
              </div>
            )}

            {/* Complete Step */}
            {currentStep === 'complete' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-xl bg-gradient-to-br from-green-500/20 to-cyan-500/20 border border-green-400/40 flex items-center justify-center mb-4">
                    <div className="w-6 h-6 rounded-full bg-green-400"></div>
                  </div>
                  <h3 className="text-lg font-mono font-bold text-green-400 mb-2 tracking-wider">SETUP COMPLETE</h3>
                  <p className="text-gray-400 font-mono text-sm">
                    Your extension is now connected and tracking AI usage.
                  </p>
                </div>

                <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-3 text-green-400 font-mono text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                    <span>Device registered</span>
                  </div>
                  <div className="flex items-center gap-3 text-green-400 font-mono text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                    <span>Connection verified</span>
                  </div>
                  <div className="flex items-center gap-3 text-green-400 font-mono text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                    <span>Ready to track</span>
                  </div>
                </div>

                <div className="text-center text-gray-500 font-mono text-xs">
                  Closing automatically...
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  )
}
