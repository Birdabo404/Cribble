import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirror the "@/*" path alias from tsconfig.json.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
  },
})
