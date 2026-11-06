/**
 * Default map tile source, shared by the app (tileConfig.ts) and the build (deploy/securityHeaders,
 * which derives the CSP img-src from it). Plain constants only: this file is also loaded by Node.
 */
export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
