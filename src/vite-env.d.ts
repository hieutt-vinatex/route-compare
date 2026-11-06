/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional tile URL template (public, no secret keys). Defaults to OSM standard tiles. */
  readonly VITE_TILE_URL?: string;
  readonly VITE_TILE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
