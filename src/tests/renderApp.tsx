import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { MockGeolocationAdapter } from '@/adapters/geolocation/MockGeolocationAdapter';
import { MockRecorderLock } from '@/adapters/locks/MockRecorderLock';
import { MockVisibilityAdapter } from '@/adapters/visibility/MockVisibilityAdapter';
import { MockWakeLockAdapter } from '@/adapters/wake-lock/MockWakeLockAdapter';
import { RouteTrackDb } from '@/data/db';
import { DexieTripRepository } from '@/data/repositories/DexieTripRepository';
import { createRoutes } from '@/app/routes';
import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/ServicesProvider';
import { DEFAULT_GPS_CONFIG } from '@/domain/models/gpsConfig';
import { TrackingController } from '@/domain/trip/TrackingController';
import { ManualClock, ManualTimers, sequentialIds } from './harness';

export interface TestServices extends AppServices {
  readonly geo: MockGeolocationAdapter;
  readonly mockVisibility: MockVisibilityAdapter;
  readonly mockWakeLock: MockWakeLockAdapter;
  readonly manualClock: ManualClock;
  readonly mockLock: MockRecorderLock;
}

let uiDbCounter = 0;

export function createTestServices(options: { secure?: boolean } = {}): TestServices {
  const geo = new MockGeolocationAdapter();
  const mockVisibility = new MockVisibilityAdapter();
  const mockWakeLock = new MockWakeLockAdapter();
  uiDbCounter += 1;
  const db = new RouteTrackDb(
    `routetrack-ui-test-${uiDbCounter}-${Math.random().toString(36).slice(2)}`,
  );
  const repository = new DexieTripRepository(db);
  const manualClock = new ManualClock();
  const mockLock = new MockRecorderLock();
  const config = DEFAULT_GPS_CONFIG;
  const tracker = new TrackingController({
    geolocation: geo,
    visibility: mockVisibility,
    wakeLock: mockWakeLock,
    repository,
    clock: manualClock,
    ids: sequentialIds(),
    config,
    timers: new ManualTimers(),
    lock: mockLock,
  });
  return {
    config,
    clock: manualClock,
    geolocation: geo,
    visibility: mockVisibility,
    wakeLock: mockWakeLock,
    repository,
    lock: mockLock,
    tracker,
    gpsSource: 'browser',
    isSecureContext: options.secure ?? true,
    geo,
    mockVisibility,
    mockWakeLock,
    manualClock,
    mockLock,
  };
}

export function renderApp(path: string, services: AppServices) {
  const router = createMemoryRouter(createRoutes(), { initialEntries: [path] });
  const utils = render(
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return { ...utils, router };
}
