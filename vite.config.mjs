import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/vue-app.html'),
      },
    },
    // Ensure assets are referenced correctly
    assetsDir: 'assets',
    // For production, use relative paths
    base: './',
    // Target modern browsers that support top-level await
    target: 'esnext',
    // Optimize build for smaller server - use esbuild (faster than terser, built-in)
    minify: 'esbuild', // esbuild is much faster than terser
    chunkSizeWarningLimit: 1000, // Increase warning limit
    // Reduce sourcemap generation (can be slow and CPU-intensive)
    sourcemap: false,
    // Disable CSS code splitting for faster builds
    cssCodeSplit: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'public/js/vue-app'),
    },
  },
})

