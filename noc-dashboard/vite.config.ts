import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/noc': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
      '/pg/buildings': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})
