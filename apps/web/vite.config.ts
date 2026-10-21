import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import ar from './src/i18n/locales/ar.json' with { type: 'json' };

// Read the API address from the root .env without Vite's loadEnv, which would also apply the
// file's NODE_ENV to this build. Nothing from that file reaches the browser bundle.
const rootEnvFile = new URL('../../.env', import.meta.url);
const rootEnv = existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, 'utf8')) : {};
const apiHost = process.env.API_HOST ?? rootEnv.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? rootEnv.API_PORT ?? '3000';

/** F16 rule A1: the brand's Vertex Green behind the app's window and splash screen. */
const VERTEX_GREEN = '#004139';

export default defineConfig({
  // F16 rule A5: each build starts the device's offline cache afresh.
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(Date.now().toString(36)) },
  // The app icons are generated into brand/ (F16 rule A1); the app holds no copy.
  publicDir: '../../brand/logo/app',
  plugins: [
    // The router plugin must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    // F16 rules A1, A2 and A6 (ADR 0036): the manifest and the service worker in
    // src/service-worker/sw.ts. The app registers it itself (src/features/app/service-worker.ts)
    // and asks before updating.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/service-worker',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,woff2,svg,png}'],
        // Arabic and Latin fonts in every weight; the shell is useless offline without them.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: ar.app.name,
        short_name: ar.app.shortName,
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: VERTEX_GREEN,
        background_color: VERTEX_GREEN,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // "New announcement" joins with the announcements screens (F16 PR D2).
        shortcuts: [
          {
            name: ar.nav.myTasks,
            url: '/tasks',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: ar.notifications.title,
            url: '/notifications',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: ar.announcements.new,
            url: '/announcements/new',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      // `pnpm dev` runs the service worker too, so push can be tried locally.
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://${apiHost}:${apiPort}` },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
