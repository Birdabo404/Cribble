// Comprehensive input validation utilities

export interface ValidationResult {
  isValid: boolean
  error?: string
  sanitized?: string
}

// Email validation with comprehensive checks
export function validateEmail(email: string): ValidationResult {
  if (!email) {
    return { isValid: false, error: 'Email is required' }
  }

  // Basic format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'Invalid email format' }
  }

  // Length checks
  if (email.length > 254) {
    return { isValid: false, error: 'Email too long' }
  }

  if (email.length < 5) {
    return { isValid: false, error: 'Email too short' }
  }

  // Additional security checks
  if (email.includes('..') || email.startsWith('.') || email.endsWith('.')) {
    return { isValid: false, error: 'Invalid email format' }
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /script/i,
    /<.*>/,
    /javascript:/i,
    /data:/i,
    /vbscript:/i
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(email)) {
      return { isValid: false, error: 'Invalid email format' }
    }
  }

  return {
    isValid: true,
    sanitized: email.toLowerCase().trim()
  }
}

// Generic string sanitization
export function sanitizeString(input: string, maxLength: number = 255): string {
  if (!input) return ''

  return input
    .trim()
    .slice(0, maxLength)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '')
}
