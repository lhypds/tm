import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Dev runs through server/index.js, which loads Vite in middleware mode and
// serves the app on the same port as the API — this config has no port
// because that server never binds its own port (server.watch only tunes the file watcher).
export default defineConfig({
  plugins: [react()],
  // VITE_POLLING=1 (in .env) finds changes by polling, for a project on a Windows drive
  // (/mnt/c under WSL) where file events never arrive.
  server: { watch: process.env.VITE_POLLING === '1' ? { usePolling: true, interval: 300 } : {} },
  resolve: {
    alias: {
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@pages': path.resolve(__dirname, 'src/pages'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@ai': path.resolve(__dirname, 'src/ai'),
    },
  },
})
