/**
 * Controllable GeolocationAdapter for unit/component tests (RT-104).
 * It never claims to be real GPS; tests drive it with replay fixtures.
 */
import type { GeoPermissionState, GpsError, RawGpsSample } from '@/domain/models/types';
import type { GeolocationAdapter, Unsubscribe } from '@/domain/ports';

export class MockGeolocationAdapter implements GeolocationAdapter {
  supported = true;
  permission: GeoPermissionState = 'granted';
  /** Result for the next getCurrentPosition() call. */
  currentPosition: RawGpsSample | GpsError | null = null;
  /** Number of real watch registrations (idempotency checks). */
  watchRegistrations = 0;
  stopCalls = 0;
  /** When set, startWatch rejects with this error. */
  startWatchError: GpsError | null = null;

  private handlers: {
    onSample: (sample: RawGpsSample) => void;
    onError: (error: GpsError) => void;
  } | null = null;
  private watching = false;
  private readonly permissionListeners = new Set<(state: GeoPermissionState) => void>();

  isSupported(): boolean {
    return this.supported;
  }

  queryPermission(): Promise<GeoPermissionState> {
    return Promise.resolve(this.permission);
  }

  onPermissionChange(listener: (state: GeoPermissionState) => void): Unsubscribe {
    this.permissionListeners.add(listener);
    return () => {
      this.permissionListeners.delete(listener);
    };
  }

  setPermission(state: GeoPermissionState): void {
    this.permission = state;
    for (const listener of this.permissionListeners) listener(state);
  }

  getCurrentPosition(): Promise<RawGpsSample> {
    const result = this.currentPosition;
    if (result === null) {
      return Promise.reject(toError({ code: 'TIMEOUT', message: 'no mock position' }));
    }
    if ('code' in result) return Promise.reject(toError(result));
    return Promise.resolve(result);
  }

  startWatch(
    onSample: (sample: RawGpsSample) => void,
    onError: (error: GpsError) => void,
  ): Promise<void> {
    if (this.startWatchError !== null) return Promise.reject(toError(this.startWatchError));
    this.handlers = { onSample, onError };
    if (!this.watching) {
      this.watching = true;
      this.watchRegistrations += 1;
    }
    return Promise.resolve();
  }

  stopWatch(): void {
    this.stopCalls += 1;
    this.watching = false;
    this.handlers = null;
  }

  isWatching(): boolean {
    return this.watching;
  }

  /** Deliver a sample to the active watcher (no-op when not watching, like a cleared watch). */
  emit(sample: RawGpsSample): void {
    if (this.watching) this.handlers?.onSample(sample);
  }

  emitError(error: GpsError): void {
    if (this.watching) this.handlers?.onError(error);
  }
}

function toError(error: GpsError): Error & GpsError {
  return Object.assign(new Error(error.message), { code: error.code });
}
