import { describe, expect, it } from 'vitest';
import { DEFAULT_TILE_URL } from '../src/components/map/tileDefaults';
import {
  cloudflareHeadersFile,
  contentSecurityPolicy,
  securityHeaders,
  tileImgSource,
} from './securityHeaders';

describe('tileImgSource', () => {
  it('uses the origin of a plain tile template', () => {
    expect(tileImgSource('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(
      'https://tile.openstreetmap.org',
    );
  });

  it('turns a templated subdomain into a wildcard', () => {
    expect(
      tileImgSource('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'),
    ).toBe('https://*.basemaps.cartocdn.com');
    expect(tileImgSource('https://tiles-{s}.example.com/{z}/{x}/{y}.png')).toBe(
      'https://*.example.com',
    );
  });

  it('keeps an explicit port and drops the query (API keys stay out of the policy)', () => {
    expect(tileImgSource('https://maps.example.com:8443/{z}/{x}/{y}.png?key=abc')).toBe(
      'https://maps.example.com:8443',
    );
  });

  it('rejects insecure, relative or unexpressible tile URLs at build time', () => {
    expect(() => tileImgSource('http://tile.openstreetmap.org/{z}/{x}/{y}.png')).toThrow(/https/);
    expect(() => tileImgSource('/tiles/{z}/{x}/{y}.png')).toThrow(/absolute/);
    expect(() => tileImgSource('https://{s}.com/{z}/{x}/{y}.png')).toThrow(/CSP/);
    expect(() => tileImgSource('https://user:pw@tiles.example.com/{z}.png')).toThrow(/credentials/);
  });
});

describe('contentSecurityPolicy', () => {
  const csp = contentSecurityPolicy(DEFAULT_TILE_URL);

  it('lets page code talk only to its own origin (no GPS upload, NFR-06)', () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows images only from the app and the configured tile origin', () => {
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    expect(csp).not.toMatch(/img-src[^;]*https:(\s|;|$)/);
  });

  it('forbids framing', () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('securityHeaders', () => {
  it('restricts powerful features to the app and keeps a Referer for the tile policy', () => {
    const headers = securityHeaders(DEFAULT_TILE_URL);
    expect(headers['Permissions-Policy']).toContain('geolocation=(self)');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('cloudflareHeadersFile', () => {
  it('applies the security headers to every path and caches hashed assets', () => {
    const file = cloudflareHeadersFile(DEFAULT_TILE_URL);
    expect(file.startsWith('/*\n  Content-Security-Policy: ')).toBe(true);
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    // Cloudflare limit: 2,000 characters per header value.
    for (const line of file.split('\n')) expect(line.length).toBeLessThan(2_000);
  });
});
