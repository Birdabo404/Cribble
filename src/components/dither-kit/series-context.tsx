"use client"

// [Cribble patch] React 18: use(Context) → useContext (use() is React 19).
import { createContext, useContext } from "react"
import type { Seed } from "./palette"

export type SeriesContextValue = {
  dataKey: string
  seed: Seed
  dimmed: boolean
}

export const SeriesContext = createContext<SeriesContextValue | null>(null)

/** Boundary guard for series-scoped markers (`<Dot>`, `<ActiveDot>`). */
export function useSeries(part: string) {
  const ctx = useContext(SeriesContext)
  if (!ctx) {
    throw new Error(
      `<${part} /> must be rendered inside a series (e.g. <Area />).`
    )
  }
  return ctx
}
