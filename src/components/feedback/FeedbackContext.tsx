'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { FeedbackModal } from './FeedbackModal'

type FeedbackContextValue = {
  openFeedback: () => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

/** Owns the single global feedback dialog while allowing navigation chrome
 * and the responsive floating launcher to provide context-appropriate triggers. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <FeedbackContext.Provider value={{ openFeedback: () => setOpen(true) }}>
      {children}
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider')
  return value
}
