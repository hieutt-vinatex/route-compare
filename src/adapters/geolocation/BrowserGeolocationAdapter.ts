/**
 * The ONLY module that touches navigator.geolocation (RT-101).
 *
 * - Lifecycle is idempotent: startWatch twice → one watchPosition; stopWatch twice → one clearWatch.
 *   This keeps React StrictMode double effects from creating duplicate watchers.
 * - Registration is synchronous, so a stopWatch() right after startWatch() never leaks a watcher.
 * - watchPosition options are a request, not a guarantee of callback frequency; browsers may stop
 *   delivering positions when the page is hidden or the screen is locked.
 */
import type { GeoPermissionState, GpsError, RawGpsSample } from '@/domain/models/types';
import type { Clock, GeolocationAdapter, Unsubscribe } from '@/domain/ports';
import { mapPositionError, normalizePosition } from './normalize';

export interface BrowserGeolocationAdapterOptions {
  readonly clock: Clock;
  readonly watchOptions: PositionOptions;
  /** Timeout for one-shot getCurrentPosition (Home preview). */
  readonly currentPositionTimeoutMs?: number;
  /** Injected for tests; defaults to globalThis.navigator / isSecureContext. */
  readonly getNavigator?: () => Navigator | undefined;
  readonly isSecureContext?: () => boolean;
}

interface Handlers {
  readonly onSample: (sample: RawGpsSample) => void;
  readonly onError: (error: GpsError) => void;
}

function mapPermissionState(state: PermissionState): GeoPermissionState {
  return state;
}

export class BrowserGeolocationAdapter implements GeolocationAdapter {
  private readonly options: BrowserGeolocationAdapterOptions;
  private watchId: number | null = null;
  private handlers: Handlers | null = null;

  constructor(options: BrowserGeolocationAdapterOptions) {
    this.options = options;
  }

  private nav(): Navigator | undefined {
    return this.options.getNavigator ? this.options.getNavigator() : globalThis.navigator;
  }

  private geo(): Geolocation | null {
    const nav = this.nav();
    if (nav === undefined || !('geolocation' in nav)) return null;
    return nav.geolocation;
  }

  private secure(): boolean {
    return this.options.isSecureContext
      ? this.options.isSecureContext()
      : globalThis.isSecureContext;
  }

  isSupported(): boolean {
    return this.geo() !== null;
  }

  async queryPermission(): Promise<GeoPermissionState> {
    const permissions = this.nav()?.permissions;
    if (permissions === undefined) return 'unknown';
    try {
      const status = await permissions.query({ name: 'geolocation' });
      return mapPermissionState(status.state);
    } catch {
      return 'unknown';
    }
  }

  onPermissionChange(listener: (state: GeoPermissionState) => void): Unsubscribe {
    const permissions = this.nav()?.permissions;
    if (permissions === undefined) return () => undefined;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const handler = (): void => {
      if (status !== null) listener(mapPermissionState(status.state));
    };
    permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener('change', handler);
      })
      .catch(() => {
        // Permissions API unavailable for geolocation in this browser: nothing to observe.
      });
    return () => {
      cancelled = true;
      status?.removeEventListener('change', handler);
    };
  }

  getCurrentPosition(): Promise<RawGpsSample> {
    return new Promise((resolve, reject: (error: GpsAdapterError) => void) => {
      const precondition = this.precondition();
      if (precondition !== null) {
        reject(new GpsAdapterError(precondition));
        return;
      }
      const geo = this.geo();
      if (geo === null) return;
      geo.getCurrentPosition(
        (position) => {
          resolve(normalizePosition(position, this.options.clock.now()));
        },
        (error) => {
          reject(new GpsAdapterError(mapPositionError(error)));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: this.options.currentPositionTimeoutMs ?? 20_000,
        },
      );
    });
  }

  startWatch(
    onSample: (sample: RawGpsSample) => void,
    onError: (error: GpsError) => void,
  ): Promise<void> {
    this.handlers = { onSample, onError };
    if (this.watchId !== null) return Promise.resolve();

    const precondition = this.precondition();
    if (precondition !== null) return Promise.reject(new GpsAdapterError(precondition));
    const geo = this.geo();
    if (geo === null) return Promise.reject(new GpsAdapterError(UNSUPPORTED));

    this.watchId = geo.watchPosition(
      (position) => {
        this.handlers?.onSample(normalizePosition(position, this.options.clock.now()));
      },
      (error) => {
        this.handlers?.onError(mapPositionError(error));
      },
      this.options.watchOptions,
    );
    return Promise.resolve();
  }

  stopWatch(): void {
    if (this.watchId !== null) {
      this.geo()?.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.handlers = null;
  }

  isWatching(): boolean {
    return this.watchId !== null;
  }

  private precondition(): GpsError | null {
    if (!this.secure()) return INSECURE;
    if (this.geo() === null) return UNSUPPORTED;
    return null;
  }
}

const UNSUPPORTED: GpsError = { code: 'UNSUPPORTED', message: 'Geolocation API is not available' };
const INSECURE: GpsError = { code: 'INSECURE_CONTEXT', message: 'Geolocation requires HTTPS' };

/** Error carrying a GpsError code (thrown from startWatch preconditions). */
export class GpsAdapterError extends Error {
  readonly code: GpsError['code'];

  constructor(error: GpsError) {
    super(error.message);
    this.name = 'GpsAdapterError';
    this.code = error.code;
  }
}
