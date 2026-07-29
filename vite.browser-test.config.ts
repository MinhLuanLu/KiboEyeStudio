import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer-only dev server for browser-based manual verification (no Electron main/preload).
// Not part of the shipped build — electron-vite's own multi-target config remains the source of
// truth for `npm run dev`/`npm run build`. Safe to delete; not referenced by any script.
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5183
  },
  plugins: [react()]
})
