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
      // shorthand string form (like '/api' above) doesn't proxy the WebSocket upgrade - needs
      // the object form with ws:true explicitly.
      '/ws': { target: 'ws://localhost:8010', ws: true },
    },
    // Vite blocks unrecognized Host headers by default (DNS-rebinding protection) - allow
    // Cloudflare Quick Tunnel hosts (random *.trycloudflare.com per run) through.
    allowedHosts: ['.trycloudflare.com'],
  },
})
