// The two fuels THE BURN can rank. Lives on its own so the CRT wrapper
// (CrtBurn) and the board that mounts it (TokenBoard) can both import it
// without a cycle — TokenBoard re-exports BurnSource for the page.

/** Which fuel THE BURN ranks: usage synced by the cribble-agent CLI, or
 *  scraped public cursor.com profiles (the no-CLI path). */
export type BurnSource = 'cli' | 'cursor'

/** What a board reports to the CRT above it: rows once landed, null while
 *  fetching, or `failed` so the tube can drop to NO CARRIER instead of
 *  scanning forever. A successful retry reports rows again. */
export type BoardFeedReport<Row> = { rows: Row[] | null; failed: boolean }

export const SOURCES: { id: BurnSource; label: string }[] = [
  { id: 'cli', label: 'CLI' },
  { id: 'cursor', label: 'CURSOR' }
]
