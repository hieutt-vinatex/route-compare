/**
 * DEV-ONLY demo source (`?gps=demo` on `npm run dev`): replays a synthetic route so the UI can be
 * exercised on a machine without GPS. Timestamps are re-based to the app clock.
 * The UI shows a permanent “GPS giả lập” banner; this is never presented as real measurement.
 */
import type { GeoPermissionState, GpsError, LatLng, RawGpsSample } from '@/domain/models/types';
import type { Clock, GeolocationAdapter, Unsubscribe } from '@/domain/ports';

export interface ReplayPoint extends LatLng {
  readonly accuracyM: number;
}

export class ReplayGeolocationAdapter implements GeolocationAdapter {
  private readonly route: readonly ReplayPoint[];
  private readonly clock: Clock;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  private onSample: ((sample: RawGpsSample) => void) | null = null;

  constructor(route: readonly ReplayPoint[], clock: Clock, intervalMs = 1_000) {
    this.route = route;
    this.clock = clock;
    this.intervalMs = intervalMs;
  }

  isSupported(): boolean {
    return true;
  }

  queryPermission(): Promise<GeoPermissionState> {
    return Promise.resolve('granted');
  }

  onPermissionChange(): Unsubscribe {
    return () => undefined;
  }

  getCurrentPosition(): Promise<RawGpsSample> {
    const point = this.route[this.index % this.route.length];
    if (point === undefined) return Promise.reject(new Error('empty demo route'));
    return Promise.resolve(this.toSample(point));
  }

  startWatch(
    onSample: (sample: RawGpsSample) => void,
    _onError: (error: GpsError) => void,
  ): Promise<void> {
    this.onSample = onSample;
    if (this.timer === null) {
      this.timer = setInterval(() => {
        const point = this.route[this.index % this.route.length];
        this.index += 1;
        if (point !== undefined) this.onSample?.(this.toSample(point));
      }, this.intervalMs);
    }
    return Promise.resolve();
  }

  stopWatch(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.onSample = null;
  }

  isWatching(): boolean {
    return this.timer !== null;
  }

  private toSample(point: ReplayPoint): RawGpsSample {
    const now = this.clock.now();
    return {
      sourceTimestamp: now,
      recordedAt: now,
      latitude: point.lat,
      longitude: point.lng,
      accuracyM: point.accuracyM,
      speedMps: null,
      headingDeg: null,
    };
  }
}
