import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow network access
    port: 5174,
    allowedHosts: [
      'localhost',
      '.localhost',
      '45304f934cbd.ngrok.app',
      '.ngrok.app',
      '.ngrok-free.app',
      '.ngrok.io',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
