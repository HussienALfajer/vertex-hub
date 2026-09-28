import { createReadStream, existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Read the API address from the root .env without Vite's loadEnv, which would also apply the
// file's NODE_ENV to this build. Nothing from that file reaches the browser bundle.
const rootEnvFile = new URL('../../.env', import.meta.url);
const rootEnv = existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, 'utf8')) : {};
const apiHost = process.env.API_HOST ?? rootEnv.API_HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? rootEnv.API_PORT ?? '3000';

/**
 * Serves the licensed Madani Arabic files at /fonts/madani/ from the git-ignored
 * brand/fonts/private/ during dev and preview (ADR 0011). They are never bundled into the build:
 * production serves them from a server path outside the repository. Missing files return 404 and
 * the browser falls back to Noto Kufi Arabic.
 */
function madaniFonts(): Plugin {
  const fontsDir = fileURLToPath(new URL('../../brand/fonts/private/', import.meta.url));
  const serve = (req: IncomingMessage, res: ServerResponse) => {
    const file = join(fontsDir, basename(req.url ?? ''));
    if (!file.endsWith('.woff2') || !existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'font/woff2');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'vertex-madani-fonts',
    configureServer: (server) => void server.middlewares.use('/fonts/madani', serve),
    configurePreviewServer: (server) => void server.middlewares.use('/fonts/madani', serve),
  };
}

export default defineConfig({
  // The router plugin must run before the React plugin.
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    madaniFonts(),
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
