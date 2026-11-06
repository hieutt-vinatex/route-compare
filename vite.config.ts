import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { cloudflareHeadersFile, securityHeaders } from './deploy/securityHeaders.ts';
import { DEFAULT_TILE_URL } from './src/components/map/tileDefaults.ts';

/** Emits Cloudflare Pages' `_headers` (CSP derived from the configured tile source). */
function cloudflareHeaders(tileUrl: string): Plugin {
  return {
    name: 'routetrack:cloudflare-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: cloudflareHeadersFile(tileUrl),
      });
    },
  };
}

// Static SPA build for Cloudflare Pages (output: dist). No backend, no SSR.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const tileUrl =
    env.VITE_TILE_URL !== undefined && env.VITE_TILE_URL !== ''
      ? env.VITE_TILE_URL
      : DEFAULT_TILE_URL;

  return {
    plugins: [react(), tailwindcss(), cloudflareHeaders(tileUrl)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
    // `vite preview` (and so Playwright E2E) serves the production headers.
    preview: {
      headers: securityHeaders(tileUrl),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/tests/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'deploy/**/*.test.ts'],
      restoreMocks: true,
      unstubGlobals: true,
    },
  };
});
