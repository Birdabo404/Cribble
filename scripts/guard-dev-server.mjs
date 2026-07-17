// npm `predev` hook. Refuses to boot a second `next dev` for this repo:
// concurrent dev servers share .next-dev and corrupt each other's build
// output (ENOENT app-paths-manifest.json / route.js, 404 page chunks,
// 500s on routes that worked seconds earlier). One rogue `npm run dev`
// from a second terminal or agent session silently breaks the first —
// this turns that into a loud, immediate failure instead.
//
// Deliberate second instance: CRIBBLE_ALLOW_SECOND_DEV=1 npm run dev

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.CRIBBLE_ALLOW_SECOND_DEV === '1') process.exit(0)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The resolved dev-server command line is `node <repo>/node_modules/.bin/next dev`,
// so matching on the absolute path scopes the check to this repo only.
const marker = `${path.join(repoRoot, 'node_modules', '.bin', 'next')} dev`

let processList = ''
try {
  processList = execFileSync('pgrep', ['-fl', 'next dev'], { encoding: 'utf8' })
} catch {
  // pgrep exits non-zero when nothing matches — no server running.
  process.exit(0)
}

const running = processList
  .split('\n')
  .filter((line) => line.includes(marker))

if (running.length > 0) {
  console.error('[dev-guard] A dev server for this repo is already running:')
  for (const line of running) console.error(`  ${line}`)
  console.error('[dev-guard] Two `next dev` instances share .next-dev and corrupt each other.')
  console.error('[dev-guard] Reuse the running server or kill it first (kill <pid>).')
  console.error('[dev-guard] To force a second instance: CRIBBLE_ALLOW_SECOND_DEV=1 npm run dev')
  process.exit(1)
}
