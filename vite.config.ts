/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { apiDevPlugin } from './vite-plugin-api'

export default defineConfig(({ mode }) => {
  // Expose every variable of .env / .env.local to the dev /api handlers (server side only).
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return {
    plugins: [react(), apiDevPlugin()],
    test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'], environment: 'node' },
  }
})
