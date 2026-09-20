import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this repo from https://<user>.github.io/goal-tracker/.
// Every asset URL, the PWA manifest's start_url/scope and the service-worker
// registration path all derive from `base` — get it wrong and the SW registers
// at the wrong scope and the app silently never works offline.
// Override with BASE_PATH=/ when attaching a custom domain or renaming the repo
// to <user>.github.io.
const base = process.env.BASE_PATH ?? '/goal-tracker/';

export default defineConfig({
  base,
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Трекер целей',
        short_name: 'Цели',
        description: 'Трекер целей и привычек',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f0f0f0',
        theme_color: '#f0f0f0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
