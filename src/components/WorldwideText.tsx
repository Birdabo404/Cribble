'use client'

import { useState, useEffect } from 'react'

interface Language {
  text: string
  font: string
  direction?: 'ltr' | 'rtl'
}

const languages: Language[] = [
  { text: 'worldwide', font: 'font-sans' }, // English
  { text: 'عالميًا', font: 'font-arabic', direction: 'rtl' }, // Arabic
  { text: '世界的に', font: 'font-japanese' }, // Japanese
  { text: '전 세계적으로', font: 'font-korean' }, // Korean
  { text: '全球', font: 'font-chinese' }, // Chinese Simplified
  { text: 'weltweit', font: 'font-german' }, // German
  { text: 'världsomspännande', font: 'font-swedish' }, // Swedish
  { text: 'в мире', font: 'font-russian' }, // Russian
  { text: 'mondialmente', font: 'font-italian' }, // Italian
  { text: 'mondialement', font: 'font-french' }, // French
  { text: 'mundialmente', font: 'font-spanish' }, // Spanish
  { text: 'wereldwijd', font: 'font-dutch' }, // Dutch
  { text: 'παγκοσμίως', font: 'font-greek' }, // Greek
  { text: 'ברחבי העולם', font: 'font-hebrew', direction: 'rtl' }, // Hebrew
  { text: 'दुनिया भर में', font: 'font-hindi' }, // Hindi
]

export default function WorldwideText() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false)
      
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % languages.length)
        setTimeout(() => {
          setIsVisible(true)
        }, 50) // Small delay to ensure width calculation happens first
      }, 400) // Slower, smoother transition
      
    }, 6000) // Change every 6 seconds

    return () => clearInterval(interval)
  }, [])

  const currentLanguage = languages[currentIndex]
  
  // Generous container widths - proper centering and comfortable "a" spacing
  const getContainerWidth = (text: string) => {
    // More generous widths for better centering and comfortable "a" spacing
    if (text.length <= 4) {
      return 200 // More space for tiny words like "全球" - comfortable "a" distance
    } else if (text.length <= 8) {
      return 260 // Generous space for short words like "в мире", "weltweit"
    } else if (text.length <= 12) {
      return 320 // Good space for medium words like "worldwide", "mondialmente"
    } else if (text.length <= 16) {
      return 400 // Plenty of space for long words like "전 세계적으로", "παγκοσμίως"
    } else {
      return 480 // Maximum space for very long words like "världsomspännande"
    }
  }

  return (
    <span 
      className={`
        inline-block
        text-center
        transition-all 
        duration-500
        ease-in-out
        ${currentLanguage.font}
        ${currentLanguage.direction === 'rtl' ? 'direction-rtl' : 'direction-ltr'}
      `}
      style={{
        color: '#02fe01',
        filter: 'drop-shadow(0 0 4px rgba(2, 254, 1, 0.2))',
        textShadow: '0 0 8px rgba(2, 254, 1, 0.3)',
        width: `${getContainerWidth(currentLanguage.text)}px`, // Dynamic width for "a" animation
        maxWidth: 'calc(100vw - 80px)', // Responsive for mobile
        letterSpacing: '0.2px',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        overflow: 'visible',
        textAlign: 'center', // Center all text within the fixed container
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0px) scale(1)' : 'translateY(-1px) scale(0.99)',
        transition: 'opacity 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94), width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)', // Smooth width transition for "a" animation
        minHeight: '1.2em',
      }}
    >
      {currentLanguage.text}
    </span>
  )
}
