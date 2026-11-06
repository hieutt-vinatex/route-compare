/**
 * Tile source is configurable (docs/03 §7). Default: OpenStreetMap standard tiles, which require
 * attribution and forbid bulk/offline prefetch (OSM Tile Usage Policy). We never prefetch tiles.
 * Tile requests reveal the viewed map area to the tile provider (privacy note in UI).
 */
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
/** Leaflet credit; opens in a new tab so a mis-tap never navigates away from a recording. */
export const LEAFLET_PREFIX =
  '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>';

const envUrl = import.meta.env.VITE_TILE_URL;
const envAttribution = import.meta.env.VITE_TILE_ATTRIBUTION;

export const TILE_URL = envUrl !== undefined && envUrl !== '' ? envUrl : DEFAULT_TILE_URL;
export const TILE_ATTRIBUTION =
  envAttribution !== undefined && envAttribution !== '' ? envAttribution : DEFAULT_ATTRIBUTION;
export const TILE_MAX_ZOOM = 19;

/** Neutral initial view (Hà Nội) used only before any position is known. */
export const DEFAULT_CENTER = { lat: 21.0285, lng: 105.8542 } as const;
export const DEFAULT_ZOOM = 13;
export const FOLLOW_ZOOM = 16;
