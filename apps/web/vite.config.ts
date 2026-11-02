import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 7100,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:7101',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:7101',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
