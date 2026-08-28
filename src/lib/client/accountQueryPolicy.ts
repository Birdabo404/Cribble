export type SessionQueryState = 'loading' | 'signed-in' | 'anonymous' | 'error'

/** Account-only client queries must wait for a positively authenticated session. */
export function shouldLoadAccountQueries(state: SessionQueryState): boolean {
  return state === 'signed-in'
}
