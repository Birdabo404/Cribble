'use client'

import { useState } from 'react'

interface GitHubLoginButtonProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
}

export default function GitHubLoginButton({
  className = '',
  size = 'md',
  variant = 'primary'
}: GitHubLoginButtonProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleLogin = async () => {
    setIsLoading(true)
    try {
      window.location.href = '/api/auth/github'
    } catch (error) {
      console.error('GitHub login error:', error)
      setIsLoading(false)
    }
  }

  const sizeClasses = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg'
  }

  const variantClasses = {
    primary: 'bg-white text-black hover:bg-gray-100 border border-gray-200',
    secondary: 'bg-gray-800/80 hover:bg-gray-700/80 border border-gray-600 hover:border-gray-500 text-white'
  }

  return (
    <button
      onClick={handleLogin}
      disabled={isLoading}
      className={`
        group inline-flex items-center gap-3
        ${variantClasses[variant]}
        rounded-md font-medium 
        transition-all duration-300 backdrop-blur-sm
        disabled:opacity-50 disabled:cursor-not-allowed
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <div className="relative">
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        )}
      </div>
      <span className="group-hover:opacity-80 transition-opacity">
        {isLoading ? 'Connecting…' : 'Continue with GitHub'}
      </span>
    </button>
  )
}

