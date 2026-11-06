import { MockGeolocationAdapter } from '@/adapters/geolocation/MockGeolocationAdapter';
import { MockRecorderLock } from '@/adapters/locks/MockRecorderLock';
import { MockVisibilityAdapter } from '@/adapters/visibility/MockVisibilityAdapter';
import { MockWakeLockAdapter } from '@/adapters/wake-lock/MockWakeLockAdapter';
import { InMemoryTripRepository } from '@/data/repositories/InMemoryTripRepository';
import { DEFAULT_GPS_CONFIG, type GpsConfig } from '@/domain/models/gpsConfig';
import type { GpsPoint, PointProcessingResult, RawGpsSample, Trip } from '@/domain/models/types';
import type { Clock, IdGenerator, Timers } from '@/domain/ports';
import { TrackingController } from '@/domain/trip/TrackingController';
import { DEFAULT_LATENCY_MS, ORIGIN, T0, toSample, type SampleSpec } from './fixtures/gpsFixtures';

export class ManualClock implements Clock {
  t: number;

  constructor(start = T0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  set(t: number): void {
    this.t = t;
  }

  advance(ms: number): void {
    this.t += ms;
  }
}

export function sequentialIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}-${n}`;
    },
  };
}

/** Timers that only fire when a test says so (tick() / fireTimeouts()). */
export class ManualTimers implements Timers {
  private nextHandle = 1;
  private readonly intervals = new Map<number, () => void>();
  private readonly timeouts = new Map<number, () => void>();

  setInterval(callback: () => void): unknown {
    const handle = this.nextHandle++;
    this.intervals.set(handle, callback);
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  setTimeout(callback: () => void): unknown {
    const handle = this.nextHandle++;
    this.timeouts.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  /** Run every interval callback once (one UI tick). */
  tick(): void {
    for (const cb of [...this.intervals.values()]) cb();
  }

  fireTimeouts(): void {
    const pending = [...this.timeouts.values()];
    this.timeouts.clear();
    for (const cb of pending) cb();
  }

  get activeIntervals(): number {
    return this.intervals.size;
  }
}

/** Shared instance for tests that never need to fire timers. */
export const manualTimers = new ManualTimers();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Repository whose writes can fail, be slow or complete out of order (like a real async store),
 * and that records the call order.
 */
export class FlakyRepository extends InMemoryTripRepository {
  failAppendRaw = false;
  failUpdateTrip = false;
  failEvents = false;
  /** When set, updateTrip() waits for this promise (a stuck IndexedDB transaction). */
  updateGate: Promise<void> | null = null;
  /** When set, create() waits for this promise (simulates a slow IndexedDB transaction). */
  createGate: Promise<void> | null = null;
  /** Per-point delay for appendRawPoint; e.g. later points finishing first. */
  rawWriteDelayMs: ((point: GpsPoint) => number) | null = null;
  readonly calls: string[] = [];

  override async create(trip: Trip): Promise<void> {
    this.calls.push('create');
    if (this.createGate !== null) await this.createGate;
    return super.create(trip);
  }

  override async appendRawPoint(point: GpsPoint): Promise<void> {
    this.calls.push(`appendRawPoint:${point.id}`);
    if (this.rawWriteDelayMs !== null) await sleep(this.rawWriteDelayMs(point));
    if (this.failAppendRaw) throw new Error('QuotaExceededError');
    return super.appendRawPoint(point);
  }

  override recordProcessingResult(pointId: string, result: PointProcessingResult): Promise<void> {
    this.calls.push(`recordProcessingResult:${pointId}`);
    return super.recordProcessingResult(pointId, result);
  }

  override async updateTrip(trip: Trip): Promise<void> {
    this.calls.push(`updateTrip:${trip.status}`);
    if (this.updateGate !== null) await this.updateGate;
    if (this.failUpdateTrip) throw new Error('QuotaExceededError');
    return super.updateTrip(trip);
  }

  override appendEvent(event: Parameters<InMemoryTripRepository['appendEvent']>[0]): Promise<void> {
    this.calls.push(`appendEvent:${event.type}`);
    if (this.failEvents) return Promise.reject(new Error('QuotaExceededError'));
    return super.appendEvent(event);
  }
}

export interface ControllerHarness {
  readonly geo: MockGeolocationAdapter;
  readonly visibility: MockVisibilityAdapter;
  readonly wakeLock: MockWakeLockAdapter;
  readonly repo: FlakyRepository;
  readonly clock: ManualClock;
  readonly timers: ManualTimers;
  readonly lock: MockRecorderLock;
  readonly controller: TrackingController;
  readonly config: GpsConfig;
  /** Set the clock to the sample's arrival time, deliver it and wait for processing. */
  emit(spec: SampleSpec): Promise<RawGpsSample>;
  /** Deliver the clock-calibration fix every trip starts with (rejected as UNTRUSTED). */
  calibrate(t?: number): Promise<void>;
  emitAll(specs: readonly SampleSpec[]): Promise<void>;
}

let reloadCount = 0;

/**
 * `shared` lets a second harness reuse the storage and clock of a first one — exactly what a
 * page reload sees (same IndexedDB, fresh JavaScript state). A reloaded page draws new random
 * UUIDs, so its ids never collide with the stored ones.
 */
export function createControllerHarness(
  config: GpsConfig = DEFAULT_GPS_CONFIG,
  shared: { repo?: FlakyRepository; clock?: ManualClock } = {},
): ControllerHarness {
  const geo = new MockGeolocationAdapter();
  const visibility = new MockVisibilityAdapter();
  const wakeLock = new MockWakeLockAdapter();
  const repo = shared.repo ?? new FlakyRepository();
  const clock = shared.clock ?? new ManualClock();
  const timers = new ManualTimers();
  const lock = new MockRecorderLock();
  const controller = new TrackingController({
    geolocation: geo,
    visibility,
    wakeLock,
    repository: repo,
    clock,
    ids: sequentialIds(shared.repo === undefined ? 'id' : `reload${++reloadCount}`),
    config,
    timers,
    lock,
  });
  const emit = async (spec: SampleSpec): Promise<RawGpsSample> => {
    const sample = toSample(spec);
    clock.set(T0 + spec.t + (spec.latencyMs ?? DEFAULT_LATENCY_MS));
    geo.emit(sample);
    await controller.settle();
    return sample;
  };
  return {
    geo,
    visibility,
    wakeLock,
    repo,
    clock,
    timers,
    lock,
    controller,
    config,
    emit,
    calibrate: async (t = 500) => {
      await emit({ t, lat: ORIGIN.lat, lng: ORIGIN.lng });
    },
    emitAll: async (specs) => {
      for (const spec of specs) await emit(spec);
    },
  };
}
