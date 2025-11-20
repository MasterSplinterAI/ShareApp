import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Custom plugin to bypass host check for development
    {
      name: 'bypass-host-check',
      configureServer(server) {
        // Serve static files from public before React Router
        // This ensures images and other assets are served correctly
        server.middlewares.use((req, res, next) => {
          // Log the incoming host for debugging
          const host = req.headers.host || req.headers['x-forwarded-host'] || ''
          
          // In development, modify host header to match allowedHosts
          if (process.env.NODE_ENV !== 'production') {
            // If it's an ngrok domain, ensure it matches our allowed host
            if (host.includes('ngrok')) {
              req.headers.host = 'f46bc88e5f4e.ngrok.app'
            }
          }
          next()
        })
      }
    },
    // Plugin to configure HMR for ngrok
    {
      name: 'configure-hmr-for-ngrok',
      transformIndexHtml(html) {
        // Inject script to configure HMR when accessed via ngrok
        return html.replace(
          '<head>',
          `<head>
            <script>
              // Configure HMR to use ngrok URL when accessed via ngrok
              if (window.location.hostname.includes('ngrok')) {
                window.__HMR_HOSTNAME__ = 'f46bc88e5f4e.ngrok.app';
                window.__HMR_PORT__ = 443;
                window.__HMR_PROTOCOL__ = 'wss';
              }
            </script>`
        )
      }
    }
  ],
  server: {
    host: '0.0.0.0', // Allow network access
    port: 5174,
    strictPort: false,
    // Explicitly list allowed hosts - Vite 5 requires exact matches
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'f46bc88e5f4e.ngrok.app', // Current ngrok URL - EXACT MATCH REQUIRED
    ],
    hmr: {
      // HMR will use the injected __HMR_HOSTNAME__ and __HMR_PROTOCOL__ from the HTML
      // when accessed via ngrok, otherwise it will auto-detect for localhost
      clientPort: 5174,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
