import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.js'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      // CRXJS does not natively support side_panel HTML entry points,
      // so we add sidepanel.html as an additional input manually.
      input: {
        sidepanel: 'sidepanel.html',
      },
    },
  },
})
