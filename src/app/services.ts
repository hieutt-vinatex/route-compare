/**
 * Composition root: wires adapters + repository into the domain TrackingController.
 * Created once outside React (main.tsx) so StrictMode cannot duplicate watchers.
 */
import { BrowserGeolocationAdapter } from '@/adapters/geolocation/BrowserGeolocationAdapter';
import { WebLocksRecorderLock } from '@/adapters/locks/WebLocksRecorderLock';
import {
  browserTimers,
  consoleLogger,
  systemClock,
  uuidGenerator,
  uuidV4,
} from '@/adapters/system';
import { PageVisibilityAdapter } from '@/adapters/visibility/PageVisibilityAdapter';
import { ScreenWakeLockAdapter } from '@/adapters/wake-lock/ScreenWakeLockAdapter';
import { RouteTrackDb } from '@/data/db';
import { LeaseRecorderLock } from '@/data/locks/LeaseRecorderLock';
import { DexieTripRepository } from '@/data/repositories/DexieTripRepository';
import { DEFAULT_GPS_CONFIG, type GpsConfig } from '@/domain/models/gpsConfig';
import type {
  Clock,
  GeolocationAdapter,
  RecorderLock,
  TripRepository,
  VisibilityAdapter,
  WakeLockAdapter,
} from '@/domain/ports';
import { TrackingController } from '@/domain/trip/TrackingController';

export type GpsSourceKind = 'browser' | 'demo';

export interface AppServices {
  readonly config: GpsConfig;
  readonly clock: Clock;
  readonly geolocation: GeolocationAdapter;
  readonly visibility: VisibilityAdapter;
  readonly wakeLock: WakeLockAdapter;
  readonly repository: TripRepository;
  readonly lock: RecorderLock;
  readonly tracker: TrackingController;
  readonly gpsSource: GpsSourceKind;
  readonly isSecureContext: boolean;
}

export interface CreateAppServicesOptions {
  /** DEV-only demo source (see main.tsx); production always uses the browser adapter. */
  readonly demoGeolocation?: GeolocationAdapter;
}

export function createAppServices(options: CreateAppServicesOptions = {}): AppServices {
  const config = DEFAULT_GPS_CONFIG;
  const clock = systemClock;
  const demo = import.meta.env.DEV ? options.demoGeolocation : undefined;
  const geolocation: GeolocationAdapter =
    demo ?? new BrowserGeolocationAdapter({ clock, watchOptions: config.watch });
  const visibility = new PageVisibilityAdapter();
  const wakeLock = new ScreenWakeLockAdapter();
  const db = new RouteTrackDb();
  const repository = new DexieTripRepository(db);
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('routetrack');
  const lock: RecorderLock = WebLocksRecorderLock.isSupported()
    ? new WebLocksRecorderLock(() => navigator, channel)
    : new LeaseRecorderLock({ db, clock, timers: browserTimers, ownerId: uuidV4(), channel });
  const tracker = new TrackingController({
    geolocation,
    visibility,
    wakeLock,
    repository,
    clock,
    ids: uuidGenerator,
    config,
    timers: browserTimers,
    logger: consoleLogger,
    lock,
  });
  return {
    config,
    clock,
    geolocation,
    visibility,
    wakeLock,
    repository,
    lock,
    tracker,
    gpsSource: demo === undefined ? 'browser' : 'demo',
    isSecureContext: globalThis.isSecureContext,
  };
}
