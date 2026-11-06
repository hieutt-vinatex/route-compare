/**
 * Ports (interfaces) implemented by src/adapters and src/data.
 * The domain depends only on these, so replay tests can inject fakes (docs/03 §4).
 */
import type {
  GeoPermissionState,
  GpsError,
  GpsPoint,
  PointProcessingResult,
  RawGpsSample,
  Trip,
  TripEvent,
} from './models/types';

export type Unsubscribe = () => void;

export interface Clock {
  /** Epoch ms UTC. */
  now(): number;
}

export interface IdGenerator {
  /** UUID v4. */
  next(): string;
}

export interface Timers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GeolocationAdapter {
  isSupported(): boolean;
  /** Permissions API state, `unknown` when the browser cannot tell. */
  queryPermission(): Promise<GeoPermissionState>;
  onPermissionChange(listener: (state: GeoPermissionState) => void): Unsubscribe;
  getCurrentPosition(): Promise<RawGpsSample>;
  /** Idempotent: a second call while watching replaces handlers, never adds a second watcher. */
  startWatch(
    onSample: (sample: RawGpsSample) => void,
    onError: (error: GpsError) => void,
  ): Promise<void>;
  /** Idempotent. */
  stopWatch(): void;
  isWatching(): boolean;
}

export interface VisibilityAdapter {
  isVisible(): boolean;
  /** Emits only on actual visible/hidden transitions (deduplicated). */
  subscribe(listener: (visible: boolean) => void): Unsubscribe;
}

/** Screen Wake Lock keeps the screen on while the page is visible. It is NOT background execution. */
export interface WakeLockAdapter {
  isSupported(): boolean;
  /** Resolves true when the lock is held. Never throws. */
  request(): Promise<boolean>;
  release(): Promise<void>;
  isActive(): boolean;
  /** Fires on any release (manual or by the system, e.g. page hidden). */
  onRelease(listener: () => void): Unsubscribe;
}

/**
 * One recorder per device/origin (BR-01, FR-13): only the tab holding this lock may record.
 * Implemented with the Web Locks API, or an IndexedDB lease where Web Locks is unavailable.
 */
export interface RecorderLock {
  /** Become the only recorder. Resolves false when another tab holds it. Idempotent. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
  /** True while ANOTHER tab holds the lock. */
  heldElsewhere(): Promise<boolean>;
  /** Re-validate that THIS tab still holds the lock (a lease can expire while the page sleeps). */
  stillHeld(): Promise<boolean>;
  /** Fires when another tab acquires or releases the lock. */
  onChange(listener: () => void): Unsubscribe;
  /** Fires when this tab discovers it no longer holds the lock (another tab took over). */
  onLost(listener: () => void): Unsubscribe;
}

export interface TripRepository {
  create(trip: Trip): Promise<void>;
  updateTrip(trip: Trip): Promise<void>;
  getTrip(id: string): Promise<Trip | undefined>;
  listTrips(): Promise<Trip[]>;
  /** Trips not yet COMPLETED (recording elsewhere, or left over after a reload/crash). */
  listActiveTrips(): Promise<Trip[]>;
  deleteTripCascade(id: string): Promise<void>;
  appendRawPoint(point: GpsPoint): Promise<void>;
  recordProcessingResult(pointId: string, result: PointProcessingResult): Promise<void>;
  appendEvent(event: TripEvent): Promise<void>;
  listPoints(tripId: string): Promise<GpsPoint[]>;
  listEvents(tripId: string): Promise<TripEvent[]>;
}
