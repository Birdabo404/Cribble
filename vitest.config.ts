import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    // Stale agent worktrees under .claude/worktrees carry duplicate
    // *.test.ts copies of old code; without the exclude vitest runs
    // them alongside the real suite.
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      '**/.next/**',
      '**/.next-dev/**',
    ],
  },
})
