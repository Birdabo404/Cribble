// Centralized logging utility for error tracking and monitoring

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: Record<string, any>
  error?: Error
  userId?: string
  ip?: string
  userAgent?: string
  endpoint?: string
}

class Logger {
  private minLevel: LogLevel

  constructor() {
    // Set log level based on environment
    this.minLevel = process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel
  }

  private formatLog(entry: LogEntry): string {
    const { timestamp, level, message, context, error, userId, ip, userAgent, endpoint } = entry
    
    const logData = {
      timestamp,
      level: LogLevel[level],
      message,
      ...(context && { context }),
      ...(error && { 
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      }),
      ...(userId && { userId }),
      ...(ip && { ip }),
      ...(userAgent && { userAgent }),
      ...(endpoint && { endpoint })
    }

    return JSON.stringify(logData)
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error
    }

    const formattedLog = this.formatLog(entry)

    // Console output with appropriate method
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedLog)
        break
      case LogLevel.INFO:
        console.info(formattedLog)
        break
      case LogLevel.WARN:
        console.warn(formattedLog)
        break
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(formattedLog)
        break
    }

    // In production, you might want to send to external logging service
    if (process.env.NODE_ENV === 'production' && level >= LogLevel.ERROR) {
      this.sendToExternalService(entry)
    }
  }

  private async sendToExternalService(entry: LogEntry): Promise<void> {
    // Placeholder for external logging service integration
    // Examples: Sentry, LogRocket, DataDog, etc.
    try {
      // Example: await sendToSentry(entry)
      // Example: await sendToLogRocket(entry)
    } catch (err) {
      // Fallback to console if external service fails
      console.error('Failed to send log to external service:', err)
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context)
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context)
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context)
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error)
  }

  critical(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.CRITICAL, message, context, error)
  }

  // API-specific logging methods
  apiRequest(endpoint: string, method: string, ip?: string, userAgent?: string): void {
    this.log(LogLevel.INFO, `API Request: ${method} ${endpoint}`, {
      endpoint,
      method,
      ip,
      userAgent
    })
  }

  apiError(endpoint: string, error: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, `API Error: ${endpoint}`, {
      endpoint,
      ...context
    }, error)
  }

  securityEvent(event: string, ip?: string, userAgent?: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, `Security Event: ${event}`, {
      event,
      ip,
      userAgent,
      ...context
    })
  }

  rateLimitHit(endpoint: string, ip?: string, limit?: number): void {
    this.log(LogLevel.WARN, `Rate limit exceeded: ${endpoint}`, {
      endpoint,
      ip,
      limit,
      type: 'rate_limit'
    })
  }
}

// Export singleton instance
export const logger = new Logger()

// Helper function for API route logging
export function logApiRequest(request: Request, endpoint: string) {
  const ip = request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'
  
  logger.apiRequest(endpoint, request.method, ip, userAgent)
}

// Helper function for API error logging
export function logApiError(endpoint: string, error: Error, context?: Record<string, any>) {
  logger.apiError(endpoint, error, context)
} 