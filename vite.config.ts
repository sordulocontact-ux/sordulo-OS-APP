/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { apiDevPlugin } from './vite-plugin-api.ts'

export default defineConfig(({ mode }) => {
  // Expose every variable of .env / .env.local to the dev /api handlers (server side only).
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return {
    plugins: [react(), apiDevPlugin()],
    // Tauri (src-tauri/tauri.conf.json devUrl) expects exactly this port.
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
      // Précharge les fonctions /api au démarrage : sinon leur premier chargement peut se bloquer
      // pendant que les fenêtres de l'app bureau rechargent tout le front en même temps.
      warmup: { ssrFiles: ['./api/**/!(*.test).ts'] },
    },
    test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'], environment: 'node' },
  }
})
