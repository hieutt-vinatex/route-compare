/**
 * Simulated browser APIs for Playwright. This exercises the REAL BrowserGeolocationAdapter /
 * PageVisibilityAdapter code paths, but positions are synthetic: passing E2E tests is NOT
 * evidence of real-device GPS behaviour (docs/07 §4 field tests are still required).
 */
import type { Page, Route } from '@playwright/test';

export interface MockPosition {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy?: number;
  readonly speed?: number | null;
  /** timestamp = Date.now() + offsetMs inside the page. */
  readonly offsetMs?: number;
}

export interface BrowserMockOptions {
  readonly permission: 'granted' | 'denied' | 'prompt';
  readonly wakeLock?: 'native' | 'missing';
}

interface RtMock {
  /** Make every IndexedDB add/put fail with QuotaExceededError (storage full), until reload. */
  failStorageWrites(): void;
  emit(position: MockPosition): void;
  emitError(code: number): void;
  setVisibility(state: DocumentVisibilityState): void;
  activeWatchers(): number;
  watchCalls(): number;
  /** Content-Security-Policy violations seen by the page (`directive blockedURI`). */
  cspViolations(): string[];
}

declare global {
  interface Window {
    __rtMock: RtMock;
  }
}

export async function installBrowserMocks(page: Page, options: BrowserMockOptions): Promise<void> {
  await page.addInitScript((opts: BrowserMockOptions) => {
    interface Waiter {
      ok: PositionCallback;
      fail: PositionErrorCallback | null;
    }
    let permission: 'granted' | 'denied' | 'prompt' = opts.permission;
    let last: GeolocationPosition | null = null;
    let nextId = 1;
    let watchCalls = 0;
    const watchers = new Map<number, Waiter>();
    const waiting: Waiter[] = [];
    const cspViolations: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });

    const makeError = (code: number): GeolocationPositionError => ({
      code,
      message: 'mock',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });

    const toPosition = (p: MockPosition): GeolocationPosition =>
      ({
        timestamp: Date.now() + (p.offsetMs ?? 0),
        coords: {
          latitude: p.lat,
          longitude: p.lng,
          accuracy: p.accuracy ?? 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: p.speed ?? null,
        },
      }) as unknown as GeolocationPosition;

    // Simulates the user accepting the browser prompt.
    const prompt = (): void => {
      if (permission === 'prompt') permission = 'granted';
    };

    const geolocation = {
      getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null) {
        prompt();
        if (permission === 'denied') {
          setTimeout(() => {
            fail?.(makeError(1));
          }, 0);
          return;
        }
        const current = last;
        if (current !== null) {
          setTimeout(() => {
            ok(current);
          }, 0);
        } else waiting.push({ ok, fail: fail ?? null });
      },
      watchPosition(ok: PositionCallback, fail?: PositionErrorCallback | null) {
        prompt();
        watchCalls += 1;
        const id = nextId++;
        watchers.set(id, { ok, fail: fail ?? null });
        if (permission === 'denied') {
          setTimeout(() => {
            fail?.(makeError(1));
          }, 0);
        }
        return id;
      },
      clearWatch(id: number) {
        watchers.delete(id);
      },
    };
    Object.defineProperty(Navigator.prototype, 'geolocation', {
      configurable: true,
      get: () => geolocation,
    });

    const status = {
      name: 'geolocation',
      get state() {
        return permission;
      },
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
    const originalQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor: PermissionDescriptor) =>
      descriptor.name === 'geolocation'
        ? Promise.resolve(status as unknown as PermissionStatus)
        : originalQuery(descriptor);

    if (opts.wakeLock === 'missing') {
      Reflect.deleteProperty(Navigator.prototype, 'wakeLock');
    }

    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => visibility === 'hidden',
    });

    let failWrites = false;
    for (const method of ['add', 'put'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['add']>
      ) {
        if (failWrites) throw new DOMException('mock quota', 'QuotaExceededError');
        return original.apply(this, args);
      };
    }

    window.__rtMock = {
      failStorageWrites() {
        failWrites = true;
      },
      emit(p) {
        const position = toPosition(p);
        last = position;
        for (const w of waiting.splice(0)) w.ok(position);
        for (const w of watchers.values()) w.ok(position);
      },
      emitError(code) {
        for (const w of watchers.values()) w.fail?.(makeError(code));
      },
      setVisibility(state) {
        visibility = state;
        document.dispatchEvent(new Event('visibilitychange'));
      },
      activeWatchers: () => watchers.size,
      watchCalls: () => watchCalls,
      cspViolations: () => [...cspViolations],
    };
  }, options);
}

// 1×1 transparent PNG so tests never hit the public OSM tile servers.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
export const TILE_HOST = 'tile.openstreetmap.org';

/** Stubs map tiles and records every request host (privacy check, NFR-06/NFR-12). */
export async function stubTilesAndRecordHosts(page: Page): Promise<Set<string>> {
  const hosts = new Set<string>();
  page.on('request', (request) => {
    hosts.add(new URL(request.url()).host);
  });
  await page.route(`**://${TILE_HOST}/**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }),
  );
  return hosts;
}

export async function emit(page: Page, position: MockPosition): Promise<void> {
  await page.evaluate((p) => {
    window.__rtMock.emit(p);
  }, position);
}

/** CSP violations so far — the production policy is served by `vite preview` (deploy/). */
export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__rtMock.cspViolations());
}

export async function setVisibility(page: Page, state: DocumentVisibilityState): Promise<void> {
  await page.evaluate((s) => {
    window.__rtMock.setVisibility(s);
  }, state);
}

/** Points along a line heading east, `stepM` apart, 1 s apart in source time. */
export function eastLine(
  from: { lat: number; lng: number },
  count: number,
  stepM: number,
  startOffsetMs: number,
): MockPosition[] {
  const metersPerDegLng = 111_194.93 * Math.cos((from.lat * Math.PI) / 180);
  return Array.from({ length: count }, (_, i) => ({
    lat: from.lat,
    lng: from.lng + (i * stepM) / metersPerDegLng,
    accuracy: 6,
    offsetMs: startOffsetMs + i * 1000,
  }));
}
