/**
 * Domain types — docs/04-DATA-MODEL.md.
 * Units: distance m, time ms (epoch UTC), speed m/s. UI converts to km, km/h.
 * Missing values are `null`, never 0 (AGENTS.md: “không hiển thị 0 khi dữ liệu không có”).
 */

export const TRANSPORT_MODES = ['WALK', 'BICYCLE', 'MOTORBIKE', 'CAR'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const TRIP_STATUSES = [
  'IDLE',
  'STARTING',
  'RECORDING',
  'PAUSED',
  'FINALIZING',
  'COMPLETED',
  'INTERRUPTED',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
/** IDLE is a controller state only; it is never persisted on a Trip. */
export type PersistedTripStatus = Exclude<TripStatus, 'IDLE'>;

export const REJECT_CODES = [
  'RANGE',
  'TIMESTAMP',
  'DUPLICATE',
  'STALE',
  'ACCURACY',
  'OUTLIER',
  'UNTRUSTED',
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export const TRIP_EVENT_TYPES = [
  'START',
  'PAUSE',
  'RESUME',
  'END',
  'GPS_GAP_BEGIN',
  'GPS_GAP_END',
  'GPS_ERROR',
  'PAGE_HIDDEN',
  'PAGE_VISIBLE',
  'WAKELOCK_ACQUIRED',
  'WAKELOCK_RELEASED',
  'STORAGE_ERROR',
  'RECOVERY',
] as const;
export type TripEventType = (typeof TRIP_EVENT_TYPES)[number];

export type QualityLabel = 'GOOD' | 'FAIR' | 'LOW';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * A browser position normalized into domain units, before any filtering.
 * `sourceTimestamp` = GeolocationPosition.timestamp; `recordedAt` = app clock at callback.
 */
export interface RawGpsSample {
  readonly sourceTimestamp: number;
  readonly recordedAt: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  readonly headingDeg: number | null;
}

export type GpsErrorCode =
  'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'INSECURE_CONTEXT';

export interface GpsError {
  readonly code: GpsErrorCode;
  readonly message: string;
}

export type GeoPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Persisted GPS sample (table `gpsPoints`). Raw values are retained even when rejected. */
export interface GpsPoint {
  readonly id: string;
  readonly tripId: string;
  readonly sourceSeq: number;
  readonly sourceTimestamp: number;
  readonly recordedAt: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  readonly headingDeg: number | null;
  /** null when rejected or not yet processed. */
  readonly segmentId: number | null;
  readonly accepted: boolean;
  /** null when accepted, or when not yet processed (accepted=false + rejectCode=null). */
  readonly rejectCode: RejectCode | null;
  readonly derivedSpeedMps: number | null;
}

export interface PointProcessingResult {
  readonly accepted: boolean;
  readonly rejectCode: RejectCode | null;
  readonly segmentId: number | null;
  readonly derivedSpeedMps: number | null;
}

export type EventMetadata = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Table `tripEvents`. `timestamp` is app-clock epoch ms (same clock as `recordedAt`).
 * `seq` comes from the same per-trip counter as `GpsPoint.sourceSeq`, so a replay can interleave
 * events and samples exactly in arrival order (D2).
 */
export interface TripEvent {
  readonly id: string;
  readonly tripId: string;
  readonly seq: number;
  readonly timestamp: number;
  readonly type: TripEventType;
  readonly metadata: EventMetadata | null;
}

/**
 * Table `trips`. Analytics fields that are not computed yet are `null`
 * (metricsVersion 0 = provisional live summary; full analytics arrive with M2).
 */
export interface Trip {
  readonly id: string;
  readonly name: string;
  readonly transportMode: TransportMode;
  readonly routeGroupId: string | null;
  readonly routeVariantLabel: string | null;
  readonly status: PersistedTripStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly startLat: number | null;
  readonly startLng: number | null;
  readonly endLat: number | null;
  readonly endLng: number | null;
  readonly distanceMeasuredM: number;
  readonly elapsedMs: number;
  readonly pausedMs: number;
  readonly movingMs: number | null;
  readonly stoppedMs: number | null;
  readonly unknownMs: number | null;
  readonly avgElapsedKmh: number | null;
  readonly avgMovingKmh: number | null;
  readonly maxSpeedKmh: number | null;
  readonly minSpeedKmh: number | null;
  readonly coveragePct: number | null;
  readonly qualityLabel: QualityLabel | null;
  readonly isIncomplete: boolean;
  readonly metricsVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
