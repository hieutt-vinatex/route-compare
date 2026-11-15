/**
 * PWA configuration (RT-501). Kept beside the security headers, and tested, because two of its
 * settings are business rules rather than preferences:
 *
 * 1. **The service worker caches the app shell only.** Map tiles are NOT precached and have NO
 *    runtime caching rule (docs/08 RT-501: "do not prefetch OSM tiles"). Mass-downloading tiles
 *    would abuse the OSM tile policy and would also tell the tile provider about areas the user
 *    never looked at.
 * 2. **The service worker never touches GPS.** `navigator.geolocation` is not available to a
 *    worker at all, and nothing here may imply background recording (AGENTS.md).
 */
import type { VitePWAOptions } from 'vite-plugin-pwa';

export const PWA_OPTIONS: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  // An external registration script: CSP is `script-src 'self'`, so an inline one would be blocked.
  injectRegister: 'script-defer',
  includeAssets: ['favicon.svg'],
  manifest: {
    name: 'RouteTrack — ghi và so sánh hành trình GPS',
    short_name: 'RouteTrack',
    description:
      'Ghi và so sánh hành trình GPS thực tế ngay trên trình duyệt. Dữ liệu lưu trên thiết bị.',
    lang: 'vi',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#0f766e',
    background_color: '#ffffff',
    icons: [
      // shortcut: one scalable SVG instead of a PNG set, upgrade when a rasteriser is in the
      // toolchain or a store listing needs fixed sizes.
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  },
  workbox: {
    // App shell only — the build's own output, nothing from the network.
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    // Source maps are shipped for debugging but must not be precached: they are large and the
    // app never needs them offline.
    globIgnores: ['**/*.map', '**/_headers'],
    navigateFallback: '/index.html',
    // No runtimeCaching at all: see rule 1 above.
    cleanupOutdatedCaches: true,
  },
};
