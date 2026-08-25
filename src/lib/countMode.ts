// What the account asked Cribble to count, chosen on the welcome flow's
// "What should Cribble count?" stage and stored as users.metadata.count_mode.
// Shared by the onboarding API (validation), the extension gate (tokens-only
// accounts are never walled on the browser extension), and the wizard itself.
export const COUNT_MODES = ['browser', 'tokens', 'both'] as const

export type CountMode = (typeof COUNT_MODES)[number]

// metadata is free-form JSON and the POST body is untrusted input, so both
// read through this: anything that isn't a literal count mode reads as null
// (unset), which every consumer treats as the pre-redesign browser default.
export function parseCountMode(value: unknown): CountMode | null {
  return typeof value === 'string' &&
    (COUNT_MODES as readonly string[]).includes(value)
    ? (value as CountMode)
    : null
}
