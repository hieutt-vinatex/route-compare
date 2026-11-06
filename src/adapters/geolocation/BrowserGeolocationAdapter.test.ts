import { describe, expect, it, vi } from 'vitest';
import type { GpsError, RawGpsSample } from '@/domain/models/types';
import { BrowserGeolocationAdapter } from './BrowserGeolocationAdapter';

function position(coords: Partial<GeolocationCoordinates>, timestamp = 1_000): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude: 21,
      longitude: 105,
      accuracy: 5,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    } as GeolocationCoordinates,
  } as GeolocationPosition;
}

function setup(options: { secure?: boolean; withGeo?: boolean; permissions?: Permissions } = {}) {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;
  const geolocation = {
    watchPosition: vi.fn(
      (s: PositionCallback, e?: PositionErrorCallback | null, _o?: PositionOptions) => {
        success = s;
        failure = e ?? null;
        return 42;
      },
    ),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  const nav = (options.withGeo === false
    ? {}
    : { geolocation, permissions: options.permissions }) as unknown as Navigator;
  const adapter = new BrowserGeolocationAdapter({
    clock: { now: () => 5_000 },
    watchOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    getNavigator: () => nav,
    isSecureContext: () => options.secure ?? true,
  });
  return {
    adapter,
    geolocation,
    fireSuccess: (p: GeolocationPosition) => success?.(p),
    fireError: (code: number) => {
      const error = {
        code,
        message: 'x',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      };
      failure?.(error as unknown as GeolocationPositionError);
    },
  };
}

describe('BrowserGeolocationAdapter (RT-101)', () => {
  it('registers a single watchPosition with the configured options, even if started twice', async () => {
    const { adapter, geolocation, fireSuccess } = setup();
    const first: RawGpsSample[] = [];
    const second: RawGpsSample[] = [];
    await adapter.startWatch(
      (s) => first.push(s),
      () => undefined,
    );
    await adapter.startWatch(
      (s) => second.push(s),
      () => undefined,
    );
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.watchPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
    fireSuccess(position({}));
    expect(first).toHaveLength(0); // handlers were replaced, not duplicated
    expect(second).toHaveLength(1);
    expect(adapter.isWatching()).toBe(true);
  });

  it('clears the watch exactly once and ignores late callbacks', async () => {
    const { adapter, geolocation, fireSuccess } = setup();
    const got: RawGpsSample[] = [];
    await adapter.startWatch(
      (s) => got.push(s),
      () => undefined,
    );
    adapter.stopWatch();
    adapter.stopWatch();
    expect(geolocation.clearWatch).toHaveBeenCalledTimes(1);
    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);
    fireSuccess(position({}));
    expect(got).toHaveLength(0);
    expect(adapter.isWatching()).toBe(false);
  });

  it('normalizes units and turns missing/NaN/negative values into null, never 0', async () => {
    const { adapter, fireSuccess } = setup();
    const got: RawGpsSample[] = [];
    await adapter.startWatch(
      (s) => got.push(s),
      () => undefined,
    );
    fireSuccess(position({ speed: Number.NaN, heading: Number.NaN }, 1_234));
    fireSuccess(position({ speed: -1, heading: 90, accuracy: 12 }, 2_000));
    fireSuccess(position({ speed: 3.5 }, 3_000));
    expect(got[0]).toEqual({
      sourceTimestamp: 1_234,
      recordedAt: 5_000,
      latitude: 21,
      longitude: 105,
      accuracyM: 5,
      speedMps: null,
      headingDeg: null,
    });
    expect(got[1]).toMatchObject({ speedMps: null, headingDeg: 90, accuracyM: 12 });
    expect(got[2]?.speedMps).toBe(3.5);
  });

  it.each([
    [1, 'PERMISSION_DENIED'],
    [2, 'POSITION_UNAVAILABLE'],
    [3, 'TIMEOUT'],
  ])('maps error code %d to %s', async (code, expected) => {
    const { adapter, fireError } = setup();
    const errors: GpsError[] = [];
    await adapter.startWatch(
      () => undefined,
      (e) => errors.push(e),
    );
    fireError(code);
    expect(errors[0]?.code).toBe(expected);
  });

  it('refuses to watch in an insecure context (HTTPS required)', async () => {
    const { adapter, geolocation } = setup({ secure: false });
    await expect(
      adapter.startWatch(
        () => undefined,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'INSECURE_CONTEXT' });
    await expect(adapter.getCurrentPosition()).rejects.toMatchObject({ code: 'INSECURE_CONTEXT' });
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('reports unsupported when navigator.geolocation is missing', async () => {
    const { adapter } = setup({ withGeo: false });
    expect(adapter.isSupported()).toBe(false);
    await expect(
      adapter.startWatch(
        () => undefined,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('getCurrentPosition resolves a normalized sample and maps errors', async () => {
    const { adapter, geolocation } = setup();
    geolocation.getCurrentPosition.mockImplementationOnce((ok: PositionCallback) => {
      ok(position({ accuracy: 7 }, 900));
    });
    await expect(adapter.getCurrentPosition()).resolves.toMatchObject({
      accuracyM: 7,
      sourceTimestamp: 900,
    });
    geolocation.getCurrentPosition.mockImplementationOnce(
      (_ok: PositionCallback, fail: PositionErrorCallback) => {
        fail({ code: 1, message: 'no' } as GeolocationPositionError);
      },
    );
    await expect(adapter.getCurrentPosition()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('queries permission state and falls back to unknown', async () => {
    const granted = setup({
      permissions: { query: () => Promise.resolve({ state: 'granted' }) } as unknown as Permissions,
    });
    await expect(granted.adapter.queryPermission()).resolves.toBe('granted');
    const throwing = setup({
      permissions: {
        query: () => Promise.reject(new TypeError('unsupported name')),
      } as unknown as Permissions,
    });
    await expect(throwing.adapter.queryPermission()).resolves.toBe('unknown');
    const missing = setup();
    await expect(missing.adapter.queryPermission()).resolves.toBe('unknown');
  });
});
