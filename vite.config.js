import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/OM_schedule/',
  server: {
    port: 5191,
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: app-only changes no longer force users to
        // re-download react/firebase/msal (~700kB of the old monolith) on
        // every deploy. react + react-dom stay together (init-order safety).
        manualChunks: {
          react: ['react', 'react-dom'],
          msal: ['@azure/msal-browser', '@azure/msal-react'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/app-check'],
        },
      },
    },
  },
})
