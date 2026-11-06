import type { LatLng } from '@/domain/models/types';

export interface MapPosition extends LatLng {
  readonly accuracyM: number | null;
  /** false when the fix was only shown, not accepted (e.g. accuracy too low). */
  readonly accepted?: boolean;
}

export interface TrackMapProps {
  /** One polyline per GPS segment; never joined across gaps. */
  readonly segments: readonly (readonly LatLng[])[];
  /** Changes whenever `segments` change (cheap redraw check). */
  readonly trackVersion?: number;
  readonly current?: MapPosition | null;
  readonly startPoint?: LatLng | null;
  readonly endPoint?: LatLng | null;
  readonly showAccuracy?: boolean;
  /** Live mode: keep the current position centred until the user drags the map. */
  readonly follow?: boolean;
  readonly onUserMovedMap?: () => void;
  /** Detail mode: fit the whole track once. */
  readonly fitToTrack?: boolean;
  readonly className?: string;
  readonly ariaLabel: string;
}
