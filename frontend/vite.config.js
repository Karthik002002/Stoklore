import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8010',
    },
    // Vite blocks unrecognized Host headers by default (DNS-rebinding protection) - allow
    // Cloudflare Quick Tunnel hosts (random *.trycloudflare.com per run) through.
    allowedHosts: ['.trycloudflare.com'],
  },
})
