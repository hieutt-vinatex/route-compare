// @vitest-environment node
/**
 * The PWA settings that are business rules, not preferences (RT-501, AGENTS.md).
 * A future "let's cache the map for offline" change has to break these tests first.
 */
import { describe, expect, it } from 'vitest';
import { PWA_OPTIONS } from './pwa';
import { readFileSync } from 'node:fs';
import { DEFAULT_TILE_URL } from '../src/components/map/tileDefaults';

describe('service worker scope (RT-501)', () => {
  it('leaves updates waiting so activation cannot interrupt an active recording', () => {
    expect(PWA_OPTIONS.registerType).toBe('prompt');
    expect(PWA_OPTIONS.workbox?.skipWaiting).not.toBe(true);
    expect(PWA_OPTIONS.workbox?.clientsClaim).not.toBe(true);
  });

  it('ships correctly sized raster icons including Apple touch and a padded maskable icon', () => {
    const manifest = PWA_OPTIONS.manifest;
    if (!manifest) throw new Error('manifest is required');
    for (const size of [192, 512]) {
      expect(manifest.icons).toContainEqual(
        expect.objectContaining({
          src: `icons/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: 'image/png',
        }),
      );
    }
    for (const [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['maskable-512.png', 512],
      ['apple-touch-icon.png', 180],
    ] as const) {
      const png = readFileSync(`public/icons/${file}`);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    expect(readFileSync('index.html', 'utf8')).toContain('rel="apple-touch-icon"');
  });
  it('precaches the app shell only, never map tiles', () => {
    const patterns = PWA_OPTIONS.workbox?.globPatterns ?? [];
    expect(patterns.length).toBeGreaterThan(0);
    // Precaching globs match build output on disk; a tile is a network URL and cannot appear.
    expect(JSON.stringify(PWA_OPTIONS)).not.toContain(new URL(DEFAULT_TILE_URL).host);
  });

  it('declares no runtime caching, so tiles are never stored by the worker', () => {
    expect(PWA_OPTIONS.workbox?.runtimeCaching).toBeUndefined();
  });

  it('never mentions geolocation: a worker must not imply background GPS', () => {
    expect(JSON.stringify(PWA_OPTIONS).toLowerCase()).not.toContain('geolocation');
  });

  it('keeps source maps out of the precache', () => {
    expect(PWA_OPTIONS.workbox?.globIgnores ?? []).toContain('**/*.map');
  });

  it('registers through an external script, which the CSP allows', () => {
    // script-src 'self' blocks an inline registration snippet.
    expect(PWA_OPTIONS.injectRegister).toBe('script-defer');
  });

  it('is installable: standalone, scoped to the app, with an icon', () => {
    const manifest = PWA_OPTIONS.manifest;
    if (manifest === undefined || manifest === false) throw new Error('manifest is required');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
    expect(manifest.icons?.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});
