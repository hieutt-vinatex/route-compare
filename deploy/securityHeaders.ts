/**
 * HTTP response headers for the static deployment (Cloudflare Pages `_headers`, docs/03 §8) and for
 * `vite preview`, so E2E runs under exactly the production policy.
 *
 * Privacy by policy (AGENTS.md, NFR-06): `connect-src 'self'` means page code cannot send data
 * (fetch/XHR/beacon/WebSocket) to any other origin, and `img-src` admits only the configured map
 * tile origin — an injected script could not leak coordinates through an image URL elsewhere.
 */

/** CSP source for the tile template's origin; `{s}`-style placeholders in the host become `*.`. */
export function tileImgSource(tileUrl: string): string {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(tileUrl.trim());
  if (match === null) throw new Error(`Tile URL is not an absolute URL: ${tileUrl}`);
  const scheme = match[1]?.toLowerCase();
  const authority = match[2] ?? '';
  if (scheme !== 'https') throw new Error(`Tile URL must use https: ${tileUrl}`);
  if (authority.includes('@')) throw new Error(`Tile URL must not embed credentials: ${tileUrl}`);
  const [host = '', port] = authority.split(':');
  const labels = host.toLowerCase().split('.');
  const lastTemplated = labels.findLastIndex((label) => /[{}]/.test(label));
  const rest = labels.slice(lastTemplated + 1);
  if (rest.length < 2 || rest.some((label) => !/^[a-z0-9-]+$/.test(label))) {
    throw new Error(`Tile URL host cannot be expressed as a CSP source: ${tileUrl}`);
  }
  const hostSource = lastTemplated >= 0 ? `*.${rest.join('.')}` : rest.join('.');
  return `https://${hostSource}${port === undefined ? '' : `:${port}`}`;
}

export function contentSecurityPolicy(tileUrl: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: blob: ${tileImgSource(tileUrl)}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Headers for every response (`/*`). */
export function securityHeaders(tileUrl: string): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(tileUrl),
    'Permissions-Policy':
      'geolocation=(self), screen-wake-lock=(self), camera=(), microphone=(), payment=(), usb=()',
    // OSM Tile Usage Policy requires a Referer; this sends only the origin cross-site.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000',
  };
}

/** Content of Cloudflare Pages' `_headers` file. Hashed build assets are cached for a year. */
export function cloudflareHeadersFile(tileUrl: string): string {
  const lines = ['/*'];
  for (const [name, value] of Object.entries(securityHeaders(tileUrl))) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push('', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '');
  return lines.join('\n');
}
