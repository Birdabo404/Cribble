'use client'

import { useState } from 'react'

interface TwitterLoginButtonProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
}

export default function TwitterLoginButton({ 
  className = '', 
  size = 'md', 
  variant = 'primary' 
}: TwitterLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async () => {
    setIsLoading(true)
    try {
      // Redirect to our Twitter OAuth endpoint
      window.location.href = '/api/auth/twitter'
    } catch (error) {
      console.error('Twitter login error:', error)
      setIsLoading(false)
    }
  }

  const sizeClasses = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg'
  }

  const variantClasses = {
    primary: 'bg-black hover:bg-gray-900 border-gray-800 hover:border-gray-700 text-white',
    secondary: 'bg-gray-800/80 hover:bg-gray-700/80 border-gray-600 hover:border-gray-500 text-white'
  }

  return (
    <button
      onClick={handleLogin}
      disabled={isLoading}
      className={`
        group inline-flex items-center gap-3 
        ${variantClasses[variant]}
        border rounded-md font-medium 
        transition-all duration-300 backdrop-blur-sm
        disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <div className="relative">
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        ) : (
          <svg 
            className="w-5 h-5 transition-transform group-hover:scale-110" 
            fill="currentColor" 
            viewBox="0 0 24 24"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.80l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        )}
        <div className="absolute inset-0 w-5 h-5 bg-white/20 rounded-full blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      </div>
      <span className="group-hover:text-gray-100 transition-colors">
        {isLoading ? 'Connecting...' : 'Continue with X'}
      </span>
    </button>
  )
} 