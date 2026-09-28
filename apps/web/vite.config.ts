import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Read the API address from the root .env without Vite's loadEnv, which would also apply the
// file's NODE_ENV to this build. Nothing from that file reaches the browser bundle.
const rootEnvFile = new URL('../../.env', import.meta.url);
const rootEnv = existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, 'utf8')) : {};
const apiHost = process.env.API_HOST ?? rootEnv.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? rootEnv.API_PORT ?? '3000';

export default defineConfig({
  // The router plugin must run before the React plugin.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
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
