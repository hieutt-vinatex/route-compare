/**
 * TrackingController — application service for one active trip (docs/03 §5, docs/05 §2, §10).
 *
 * Pure TypeScript: talks to the browser only through injected ports, so it runs under
 * replay tests with fakes and is safe under React StrictMode (it lives outside React).
 *
 * Ordering & safety rules:
 * - Every GPS callback, GPS error and visibility boundary is pushed onto ONE serial queue,
 *   so processing order = arrival order, and callbacks never race on async writes.
 * - A raw sample is persisted BEFORE it is processed. If that write fails the sample is not
 *   counted and the UI shows a storage error (no false “safe” state).
 * - Hidden page / time gap / watcher restart closes the segment: no bridging distance.
 * - UI refresh is throttled (tick every `uiRefreshMs`); raw persistence is never throttled.
 */
import { avgElapsedKmh, mpsToKmh } from '../analytics/speed';
import {
  applyBoundary,
  createTrackProcessor,
  hasFreshFix,
  hasValidRange,
  liveSpeedMps,
  processSample,
  type RejectCounts,
  type SampleOutcome,
  type TrackProcessorState,
} from '../geo/trackProcessor';
import type { GpsConfig } from '../models/gpsConfig';
import type {
  EventMetadata,
  GpsError,
  GpsErrorCode,
  GpsPoint,
  LatLng,
  RawGpsSample,
  TransportMode,
  Trip,
  TripEventType,
  TripStatus,
} from '../models/types';
import type {
  Clock,
  GeolocationAdapter,
  IdGenerator,
  RecorderLock,
  Timers,
  TripRepository,
  Unsubscribe,
  VisibilityAdapter,
  WakeLockAdapter,
} from '../ports';
import { nextStatus, type TripCommand } from './stateMachine';
import { analyzeTrip } from '../analytics/analyzeTrip';
import { replayTrack } from '../analytics/replay';
import { lastActivityAt, maxSequence } from './recovery';
import { applyMetrics, createTrip } from './tripFactory';

export interface TrackingControllerDeps {
  readonly geolocation: GeolocationAdapter;
  readonly visibility: VisibilityAdapter;
  readonly wakeLock: WakeLockAdapter;
  readonly repository: TripRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly config: GpsConfig;
  readonly timers: Timers;
  /** One recorder per device (FR-13). */
  readonly lock: RecorderLock;
  /** Receives internal failures (message only — never coordinates). */
  readonly logger?: { error(message: string): void };
}

export interface StartTripInput {
  readonly name: string;
  readonly transportMode: TransportMode;
}

/**
 * NONE: no active recording · ACQUIRING: waiting for a usable fix (start / after returning)
 * OK: recent accepted fix · LOST: no usable fix for > maxGapMs · HIDDEN: page not visible
 * ERROR: last GPS callback was an error (timeout/unavailable).
 */
export type SignalState = 'NONE' | 'ACQUIRING' | 'OK' | 'LOST' | 'HIDDEN' | 'ERROR';

export type InterruptReason = 'GPS_FATAL' | 'FINALIZE_FAILED';

export interface LiveFix {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly recordedAt: number;
  readonly accepted: boolean;
}

export interface LiveTrack {
  /** Increments whenever segments change; lets the map skip redundant redraws. */
  readonly version: number;
  /** One polyline per GPS segment. Never joined across gaps. */
  readonly segments: readonly (readonly LatLng[])[];
}

export interface WakeLockState {
  readonly supported: boolean;
  readonly wanted: boolean;
  readonly active: boolean;
  readonly failed: boolean;
}

export interface TrackingSnapshot {
  readonly status: TripStatus;
  readonly tripId: string | null;
  readonly tripName: string | null;
  readonly transportMode: TransportMode | null;
  readonly startedAt: number | null;
  readonly elapsedMs: number;
  readonly distanceMeasuredM: number;
  readonly currentSpeedKmh: number | null;
  readonly avgElapsedKmh: number | null;
  readonly signal: SignalState;
  readonly lastFix: LiveFix | null;
  readonly startPoint: LatLng | null;
  readonly rawCount: number;
  readonly acceptedCount: number;
  readonly rejectCounts: RejectCounts;
  readonly segmentCount: number;
  readonly gapCount: number;
  readonly hiddenCount: number;
  /** Most recent hidden interval (app clock), shown as an “unmeasured” notice. */
  readonly lastHiddenInterval: { readonly from: number; readonly to: number } | null;
  readonly startWaitExceeded: boolean;
  readonly gpsError: GpsError | null;
  readonly interruptReason: InterruptReason | null;
  readonly storageError: boolean;
  readonly internalError: boolean;
  /** Start was refused because another tab of this browser is recording (FR-13). */
  readonly recorderBusy: boolean;
  readonly wakeLock: WakeLockState;
  readonly track: LiveTrack;
  readonly lastCompletedTripId: string | null;
}

const FATAL_GPS_ERRORS: ReadonlySet<GpsErrorCode> = new Set([
  'PERMISSION_DENIED',
  'UNSUPPORTED',
  'INSECURE_CONTEXT',
]);

const EMPTY_TRACK: LiveTrack = { version: 0, segments: [] };

export class TrackingController {
  private readonly deps: TrackingControllerDeps;
  private readonly listeners = new Set<() => void>();

  private status: TripStatus = 'IDLE';
  private trip: Trip | null = null;
  private proc: TrackProcessorState;
  /** Incremented per trip; callbacks from an older trip/watch are ignored. */
  private generation = 0;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private acceptingSamples = false;
  private cancelRequested = false;
  /** In-flight start()/cancelStart() so overlapping commands never interleave (review I3). */
  private startTask: Promise<void> | null = null;
  private cancelTask: Promise<void> | null = null;

  private segments: LatLng[][] = [];
  private trackVersion = 0;
  private trackDirty = false;
  private publishedTrack: LiveTrack = EMPTY_TRACK;
  private lastFix: LiveFix | null = null;

  private hiddenSince: number | null = null;
  /** App-clock time the watch (re)started after a boundary (visible / continue). */
  private lastResumeAt: number | null = null;
  private lastHiddenInterval: { from: number; to: number } | null = null;
  private acquiringSince: number | null = null;
  private gpsError: GpsError | null = null;
  private gpsErrorAt: number | null = null;
  private interruptReason: InterruptReason | null = null;
  private hadInterruption = false;
  private storageError = false;
  private internalError = false;
  private recorderBusy = false;
  private wakeWanted = false;
  private wakeFailed = false;
  private endEventsWritten = false;
  /** First End press; kept across finalize retries so elapsed time does not grow. */
  private endedAt: number | null = null;
  private lastCheckpointAt = 0;
  private lastCompletedTripId: string | null = null;

  private tickHandle: unknown = null;
  private visibilityUnsub: Unsubscribe | null = null;
  private lockLostUnsub: Unsubscribe | null = null;
  private permissionUnsub: Unsubscribe | null = null;
  private wakeReleaseUnsub: Unsubscribe | null = null;

  private snapshot: TrackingSnapshot;

  constructor(deps: TrackingControllerDeps) {
    this.deps = deps;
    this.proc = createTrackProcessor(deps.config);
    this.snapshot = this.buildSnapshot();
  }

  // ---------------------------------------------------------------- store API

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TrackingSnapshot => this.snapshot;

  /** Wait until every queued sample/event is handled, then publish. */
  async settle(): Promise<void> {
    await this.queue;
    this.publish();
  }

  // ---------------------------------------------------------------- commands

  /** User pressed Start. Idempotent: ignored unless IDLE. */
  start(input: StartTripInput): Promise<void> {
    if (this.status !== 'IDLE') return Promise.resolve();
    const task = this.runStart(input);
    this.startTask = task;
    return task.finally(() => {
      if (this.startTask === task) this.startTask = null;
    });
  }

  private async runStart(input: StartTripInput): Promise<void> {
    const { geolocation, clock, ids, repository, config } = this.deps;
    this.resetSession();

    if (!geolocation.isSupported()) {
      this.gpsError = { code: 'UNSUPPORTED', message: 'Geolocation API is not available' };
      this.publish();
      return;
    }

    const now = clock.now();
    const trip = createTrip({
      id: ids.next(),
      name: input.name,
      transportMode: input.transportMode,
      startedAt: now,
    });
    this.generation += 1;
    this.trip = trip;
    this.lastCheckpointAt = now;
    this.proc = createTrackProcessor(config, {
      startedAt: now,
      transportMode: input.transportMode,
    });
    this.acquiringSince = now;
    this.transition('START');
    this.publish();

    // The lock comes first: a second tab must not even create a trip row (FR-13).
    if (!(await this.deps.lock.acquire())) {
      this.recorderBusy = true;
      this.trip = null;
      if (this.currentStatus() === 'STARTING') this.transition('START_FAILED');
      this.publish();
      return;
    }
    if (this.wasCancelled()) return; // cancelStart releases the lock

    try {
      await repository.create(trip);
    } catch {
      this.storageError = true;
      this.trip = null;
      await this.deps.lock.release();
      if (this.currentStatus() === 'STARTING') this.transition('START_FAILED');
      this.publish();
      return;
    }
    // Cancelled while the row was being written: never start GPS (cancelStart cleans up).
    if (this.wasCancelled()) return;

    this.enqueueEvent('START', now, { transportMode: input.transportMode });
    this.attachLifecycle();
    await this.beginWatch();
    // A cancel arriving meanwhile waits for this task, then its teardown releases the lock.
    if (this.wakeWanted) await this.acquireWakeLock();
  }

  /** Cancel while STARTING (no valid start fix yet). The empty trip is deleted. Idempotent. */
  cancelStart(): Promise<void> {
    if (this.cancelTask !== null) return this.cancelTask;
    if (this.status !== 'STARTING') return Promise.resolve();
    const task = this.runCancel();
    this.cancelTask = task;
    return task.finally(() => {
      if (this.cancelTask === task) this.cancelTask = null;
    });
  }

  private async runCancel(): Promise<void> {
    this.cancelRequested = true;
    // Let an in-flight start() finish writing the trip row first, so the delete wins.
    if (this.startTask !== null) await this.startTask;
    this.stopWatching();
    await this.queue;
    // A fatal GPS error or a failed create may have ended STARTING meanwhile.
    if (this.currentStatus() !== 'STARTING') return;
    await this.discardTrip();
    this.transition('CANCEL');
    await this.teardown();
    this.publish();
  }

  /** Finalize. Returns the completed trip id, or null if finalizing failed (trip kept). */
  async end(): Promise<string | null> {
    const next = nextStatus(this.status, 'END');
    if (next === null || this.trip === null) return null;
    const { clock, config } = this.deps;
    // A pause running into End is PAUSED time, not an unmeasured GPS gap.
    const endedWhilePaused = this.status === 'PAUSED';
    this.transition('END');
    this.publish();

    this.stopWatching();
    this.detachVisibility();
    this.endedAt ??= clock.now();

    const saving = this.finalize(this.endedAt, endedWhilePaused);
    let final: Trip;
    try {
      // IndexedDB can hang (blocked upgrade, OS pressure): never leave the UI in FINALIZING.
      final = await this.withTimeout(saving, config.finalizeTimeoutMs);
    } catch {
      // FINALIZING failed: keep everything, let the user retry. Never delete the track.
      this.storageError = true;
      this.interruptReason = 'FINALIZE_FAILED';
      this.hadInterruption = true;
      this.transition('FINALIZE_FAILED');
      this.publish();
      // A save that only timed out may still commit: adopt it instead of losing it (review I1).
      saving.then(
        (late) => void this.adoptLateFinalize(late),
        () => undefined,
      );
      return null;
    }
    await this.completeTrip(final);
    return final.id;
  }

  private async completeTrip(final: Trip): Promise<void> {
    this.transition('FINALIZED');
    this.lastCompletedTripId = final.id;
    await this.teardown();
    this.trip = null;
    this.transition('RESET');
    this.publish();
  }

  private async adoptLateFinalize(final: Trip): Promise<void> {
    const trip = this.currentTrip();
    if (
      trip?.id !== final.id ||
      this.currentStatus() !== 'INTERRUPTED' ||
      this.interruptReason !== 'FINALIZE_FAILED'
    ) {
      return;
    }
    this.transition('END');
    await this.completeTrip(final);
  }

  // ---------------------------------------------------------------- reload recovery (FR-12)

  /**
   * An unfinished trip left by a reload/crash/closed tab, unless this tab is busy or another tab
   * is recording (then it is not abandoned).
   */
  async findRecoverable(): Promise<Trip | null> {
    if (this.status !== 'IDLE') return null;
    if (await this.deps.lock.heldElsewhere()) return null;
    const trips = await this.deps.repository.listActiveTrips();
    return [...trips].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  }

  /**
   * Continue an unfinished trip after a reload. Nothing is reconstructed for the time the page
   * was closed: the persisted data is replayed, then recording resumes in a NEW segment.
   */
  async resumeRecovered(id: string): Promise<void> {
    if (this.status !== 'IDLE') return;
    const { repository, config, clock, lock } = this.deps;
    this.resetSession();
    if (!(await lock.acquire())) {
      this.recorderBusy = true;
      this.publish();
      return;
    }
    const trip = await repository.getTrip(id);
    if (trip === undefined || trip.status === 'COMPLETED') {
      await lock.release();
      return;
    }
    const [points, events] = await Promise.all([
      repository.listPoints(id),
      repository.listEvents(id),
    ]);
    const replay = replayTrack({ trip, points, events, config });
    const at = clock.now();
    const command: TripCommand =
      replay.state.firstAccepted === null
        ? 'RESTORE_STARTING'
        : // Never RECORDING while the replayed processor is still paused (review I2).
          replay.state.paused
          ? 'RESTORE_PAUSED'
          : 'RESTORE_RECORDING';

    this.generation += 1;
    this.trip = trip;
    this.proc = replay.state;
    this.segments = replay.segments.map((segment) => [...segment]);
    this.trackDirty = true;
    this.seq = maxSequence(points, events);
    this.hadInterruption = true;
    this.lastCheckpointAt = at;
    this.lastResumeAt = at;
    this.acquiringSince = at;
    this.transition(command);

    const seq = this.nextSeq();
    const lastActivity = lastActivityAt(trip, points, events);
    const persistedStatus = this.currentStatus();
    this.enqueue(async () => {
      this.proc = applyBoundary(this.proc, { kind: 'WATCH_RESTART', at }, config);
      await this.appendEvent(
        'RECOVERY',
        at,
        { reason: 'RELOAD', lastActivityAt: lastActivity },
        seq,
      );
      if (persistedStatus !== 'IDLE') await this.persistTripStatus(persistedStatus, repository);
    });
    this.attachLifecycle();
    this.publish();
    if (command !== 'RESTORE_PAUSED') await this.beginWatch();
  }

  /**
   * End an unfinished trip after a reload without recording more. endedAt is the last persisted
   * activity (R1) — never the moment the app was reopened. Returns null when nothing was measured
   * (such a trip can only be discarded, D3) or when another tab holds the recorder.
   */
  async endRecovered(id: string): Promise<string | null> {
    if (this.status !== 'IDLE') return null;
    const { repository, config, clock, lock, ids } = this.deps;
    if (!(await lock.acquire())) {
      this.recorderBusy = true;
      this.publish();
      return null;
    }
    try {
      const trip = await repository.getTrip(id);
      if (trip === undefined || trip.status === 'COMPLETED') return null;
      const [points, events] = await Promise.all([
        repository.listPoints(id),
        repository.listEvents(id),
      ]);
      // End already pressed (save failed/interrupted): that moment is the end, not later activity.
      const endedAt =
        events.findLast((e) => e.type === 'END')?.timestamp ?? lastActivityAt(trip, points, events);
      const metrics = analyzeTrip({ trip, points, events, endedAt, config });
      if (metrics.start === null) return null;
      let seq = maxSequence(points, events);
      for (const [type, metadata] of [
        ['RECOVERY', { reason: 'END_AFTER_RELOAD', decidedAt: clock.now() }],
        ['END', null],
      ] as const) {
        seq += 1;
        await repository.appendEvent({
          id: ids.next(),
          tripId: id,
          seq,
          timestamp: endedAt,
          type,
          metadata,
        });
      }
      await repository.updateTrip(
        applyMetrics(trip, metrics, { endedAt, hadInterruption: true, hadStorageError: false }),
      );
      this.lastCompletedTripId = id;
      this.publish();
      return id;
    } finally {
      await lock.release();
    }
  }

  /** Delete an unfinished trip that never got a valid start fix (D3). Anything else is kept. */
  async discardRecovered(id: string): Promise<void> {
    if (this.status !== 'IDLE') return;
    const { repository, config, lock } = this.deps;
    if (!(await lock.acquire())) return;
    try {
      const trip = await repository.getTrip(id);
      if (trip === undefined || trip.status === 'COMPLETED') return;
      const [points, events] = await Promise.all([
        repository.listPoints(id),
        repository.listEvents(id),
      ]);
      if (replayTrack({ trip, points, events, config }).state.firstAccepted !== null) return;
      await repository.deleteTripCascade(id);
    } finally {
      await lock.release();
    }
  }

  /** Drain pending samples, write END, run analytics on the persisted data and save. */
  private async finalize(endedAt: number, endedWhilePaused: boolean): Promise<Trip> {
    const { config, repository } = this.deps;
    await this.queue;
    // A watch registered by a just-finished visible handler must not survive End.
    this.stopWatching();
    const trip = this.currentTrip();
    if (trip === null) throw new Error('no active trip');
    const lastFixFresh = hasFreshFix(this.proc, endedAt, config);

    await this.releaseWakeLockForEnd(endedAt);
    if (!this.endEventsWritten) {
      const gapFrom = endedWhilePaused ? null : this.unresolvedGapStart(lastFixFresh);
      if (gapFrom !== null) {
        // GPS was lost (or never came back after a boundary) before End: record the open gap.
        await this.appendEvent('GPS_GAP_BEGIN', gapFrom, { unresolvedAtEnd: true });
      }
      await this.appendEvent('END', endedAt, null);
      this.endEventsWritten = true;
    }

    const [points, events] = await Promise.all([
      repository.listPoints(trip.id),
      repository.listEvents(trip.id),
    ]);
    const metrics = analyzeTrip({ trip, points, events, endedAt, config });
    const final = applyMetrics(trip, metrics, {
      endedAt,
      hadInterruption: this.hadInterruption,
      hadStorageError: this.storageError,
    });
    await repository.updateTrip(final);
    return final;
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    const { timers } = this.deps;
    return new Promise<T>((resolve, reject) => {
      const handle = timers.setTimeout(() => {
        reject(new Error(`timed out after ${ms} ms`));
      }, ms);
      promise.then(
        (value) => {
          timers.clearTimeout(handle);
          resolve(value);
        },
        (err: unknown) => {
          timers.clearTimeout(handle);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  /** Persist live progress so a reload can recover the trip (R1: last persisted activity). */
  private enqueueCheckpoint(at: number): void {
    if (this.endedAt !== null) return;
    this.lastCheckpointAt = at;
    this.enqueue(async () => {
      const trip = this.trip;
      if (trip === null || this.status === 'FINALIZING' || this.status === 'IDLE') return;
      this.trip = {
        ...trip,
        distanceMeasuredM: this.proc.distanceMeasuredM,
        elapsedMs: Math.max(0, at - trip.startedAt),
        updatedAt: at,
      };
      try {
        await this.deps.repository.updateTrip(this.trip);
      } catch {
        await this.onStorageFailure('checkpoint');
      }
    });
  }

  /** User pause (RECORDING only). GPS is switched off; pause time is PAUSED, never UNKNOWN. */
  async pause(): Promise<void> {
    if (this.status !== 'RECORDING') return;
    const { clock, config, repository } = this.deps;
    const at = clock.now();
    this.transition('PAUSE');
    this.stopWatching();
    const seq = this.nextSeq();
    this.enqueue(async () => {
      this.proc = applyBoundary(this.proc, { kind: 'PAUSE', at }, config);
      await this.appendEvent('PAUSE', at, null, seq);
      await this.persistTripStatus('PAUSED', repository);
    });
    this.publish();
    await this.queue;
  }

  /** Resume after a pause: GPS restarts and the next fix opens a new segment. */
  async resume(): Promise<void> {
    if (this.status !== 'PAUSED') return;
    const { clock, config, repository } = this.deps;
    const at = clock.now();
    this.transition('RESUME');
    this.gpsError = null;
    this.gpsErrorAt = null;
    this.acquiringSince = at;
    this.lastResumeAt = at;
    const seq = this.nextSeq();
    this.enqueue(async () => {
      this.proc = applyBoundary(this.proc, { kind: 'RESUME', at }, config);
      await this.appendEvent('RESUME', at, null, seq);
      await this.persistTripStatus('RECORDING', repository);
    });
    this.publish();
    await this.beginWatch();
  }

  /** INTERRUPTED (GPS fatal error) → RECORDING in a NEW segment. */
  async continueAfterInterruption(): Promise<void> {
    if (this.status !== 'INTERRUPTED' || this.interruptReason !== 'GPS_FATAL') return;
    const { clock, config, repository } = this.deps;
    const at = clock.now();
    this.transition('CONTINUE');
    this.interruptReason = null;
    this.gpsError = null;
    this.acquiringSince = at;
    this.lastResumeAt = at;
    const seq = this.nextSeq();
    this.enqueue(async () => {
      this.proc = applyBoundary(this.proc, { kind: 'WATCH_RESTART', at }, config);
      await this.appendEvent('RECOVERY', at, { reason: 'CONTINUE_AFTER_INTERRUPTION' }, seq);
      await this.persistTripStatus('RECORDING', repository);
    });
    this.publish();
    await this.beginWatch();
  }

  /** Optional Screen Wake Lock. Only keeps the screen on while visible — NOT background GPS. */
  async setKeepScreenOn(wanted: boolean): Promise<void> {
    this.wakeWanted = wanted;
    this.wakeFailed = false;
    if (wanted) {
      if (this.trip !== null) await this.acquireWakeLock();
    } else if (this.deps.wakeLock.isActive()) {
      await this.deps.wakeLock.release();
    }
    this.publish();
  }

  dispose(): void {
    this.stopWatching();
    this.detachVisibility();
    this.detachWakeRelease();
    this.stopTick();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- GPS callbacks

  private async beginWatch(): Promise<void> {
    const gen = this.generation;
    this.acceptingSamples = true;
    try {
      await this.deps.geolocation.startWatch(
        (sample) => {
          this.onSample(sample, gen);
        },
        (error) => {
          this.onGpsError(error, gen);
        },
      );
    } catch (err) {
      this.onGpsError(toGpsError(err), gen);
    }
  }

  private stopWatching(): void {
    this.acceptingSamples = false;
    this.deps.geolocation.stopWatch();
  }

  private onSample(sample: RawGpsSample, gen: number): void {
    const trip = this.trip;
    if (!this.acceptingSamples || gen !== this.generation || trip === null) return;
    const seq = this.nextSeq();
    const pointId = this.deps.ids.next();
    this.enqueue(() => this.handleSample(trip.id, seq, pointId, sample));
  }

  private async handleSample(
    tripId: string,
    sourceSeq: number,
    pointId: string,
    sample: RawGpsSample,
  ): Promise<void> {
    const { repository, config } = this.deps;
    const point: GpsPoint = {
      id: pointId,
      tripId,
      sourceSeq,
      ...sample,
      segmentId: null,
      accepted: false,
      rejectCode: null,
      derivedSpeedMps: null,
    };

    // 1. Persist RAW before relying on the sample (docs/05 §10).
    try {
      await repository.appendRawPoint(point);
    } catch {
      await this.onStorageFailure('appendRawPoint');
      return;
    }

    // 2. Filter + segment (pure).
    const { state, outcome } = processSample(this.proc, sample, config);
    this.proc = state;
    this.updateLastFix(sample, outcome);

    // 3. Persist the processing result.
    try {
      await repository.recordProcessingResult(pointId, {
        accepted: outcome.accepted,
        rejectCode: outcome.rejectCode,
        segmentId: outcome.segmentId,
        derivedSpeedMps: outcome.derivedSpeedMps,
      });
    } catch {
      await this.onStorageFailure('recordProcessingResult');
    }

    const gap = outcome.openedSegment?.gap;
    if (gap) {
      await this.appendEvent('GPS_GAP_BEGIN', gap.fromRecordedAt, {
        sourceTimestamp: gap.fromSourceTimestamp,
      });
      await this.appendEvent('GPS_GAP_END', gap.toRecordedAt, {
        sourceTimestamp: gap.toSourceTimestamp,
        gapMs: gap.toSourceTimestamp - gap.fromSourceTimestamp,
      });
    }

    if (!outcome.accepted) return;
    this.appendToTrack(sample, outcome);
    this.acquiringSince = null;
    if (this.gpsError !== null && !FATAL_GPS_ERRORS.has(this.gpsError.code)) {
      this.gpsError = null;
      this.gpsErrorAt = null;
    }
    if (this.status === 'STARTING' && !this.cancelRequested) {
      await this.promoteToRecording();
    }
  }

  private async promoteToRecording(): Promise<void> {
    const trip = this.trip;
    const first = this.proc.firstAccepted;
    if (trip === null || first === null) return;
    this.transition('GPS_OK');
    this.trip = {
      ...trip,
      status: 'RECORDING',
      startLat: first.lat,
      startLng: first.lng,
      updatedAt: this.deps.clock.now(),
    };
    try {
      await this.deps.repository.updateTrip(this.trip);
    } catch {
      await this.onStorageFailure('updateTrip');
    }
    this.publish();
  }

  private onGpsError(error: GpsError, gen: number): void {
    if (gen !== this.generation || this.trip === null) return;
    const at = this.deps.clock.now();
    const seq = this.nextSeq();
    this.enqueue(async () => {
      if (this.trip === null) return;
      await this.appendEvent('GPS_ERROR', at, { code: error.code }, seq);
      if (FATAL_GPS_ERRORS.has(error.code)) {
        await this.handleFatalGpsError(error);
      } else {
        // TIMEOUT / POSITION_UNAVAILABLE: the watch keeps running; the time-gap rule
        // will split the segment if no fix arrives for > maxGapMs.
        this.gpsError = error;
        this.gpsErrorAt = at;
      }
      this.publish();
    });
  }

  private async handleFatalGpsError(error: GpsError): Promise<void> {
    this.gpsError = error;
    this.gpsErrorAt = this.deps.clock.now();
    this.stopWatching();
    if (this.status === 'STARTING') {
      // No valid start fix: do not create a trip (SRS §6).
      await this.discardTrip();
      this.transition('START_FAILED');
      await this.teardown();
      return;
    }
    if (this.status === 'PAUSED') {
      // GPS is already off; keep the pause. Resume re-requests GPS and fails visibly if needed.
      return;
    }
    if (this.status === 'RECORDING') {
      this.transition('FATAL_ERROR');
      this.interruptReason = 'GPS_FATAL';
      this.hadInterruption = true;
      await this.persistTripStatus('INTERRUPTED', this.deps.repository);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  private attachLifecycle(): void {
    if (this.visibilityUnsub === null) {
      this.visibilityUnsub = this.deps.visibility.subscribe(this.onVisibilityChange);
    }
    if (this.wakeReleaseUnsub === null) {
      this.wakeReleaseUnsub = this.deps.wakeLock.onRelease(this.onWakeLockReleased);
    }
    if (this.permissionUnsub === null) {
      // Some browsers revoke permission without a watch error: treat “denied” as fatal.
      const gen = this.generation;
      this.permissionUnsub = this.deps.geolocation.onPermissionChange((state) => {
        if (state === 'denied') {
          this.onGpsError({ code: 'PERMISSION_DENIED', message: 'permission revoked' }, gen);
        }
      });
    }
    if (this.lockLostUnsub === null) {
      this.lockLostUnsub = this.deps.lock.onLost(this.onRecorderLost);
    }
    if (this.tickHandle === null) {
      this.tickHandle = this.deps.timers.setInterval(this.onTick, this.deps.config.uiRefreshMs);
    }
  }

  /**
   * Another tab took over the recorder lock (e.g. our lease expired while this page slept): stop
   * writing immediately — the other tab owns the trip now (review I4).
   */
  private readonly onRecorderLost = (): void => {
    if (this.trip === null) return;
    this.generation += 1; // drops queued work and late callbacks of this tab
    this.stopWatching();
    this.detachVisibility();
    this.detachWakeRelease();
    this.lockLostUnsub?.();
    this.lockLostUnsub = null;
    this.stopTick();
    if (this.deps.wakeLock.isActive()) void this.deps.wakeLock.release();
    this.trip = null;
    this.recorderBusy = true;
    this.transition('ABANDON');
    this.publish();
  };

  private async verifyRecorderLock(): Promise<void> {
    if (this.trip !== null && !(await this.deps.lock.stillHeld())) this.onRecorderLost();
  }

  private detachVisibility(): void {
    this.visibilityUnsub?.();
    this.visibilityUnsub = null;
    this.permissionUnsub?.();
    this.permissionUnsub = null;
  }

  private detachWakeRelease(): void {
    this.wakeReleaseUnsub?.();
    this.wakeReleaseUnsub = null;
  }

  private stopTick(): void {
    if (this.tickHandle !== null) {
      this.deps.timers.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private async teardown(): Promise<void> {
    this.stopWatching();
    this.detachVisibility();
    this.detachWakeRelease();
    this.lockLostUnsub?.();
    this.lockLostUnsub = null;
    this.stopTick();
    if (this.deps.wakeLock.isActive()) await this.deps.wakeLock.release();
    await this.deps.lock.release();
  }

  private readonly onTick = (): void => {
    if (this.trip === null) return;
    const now = this.deps.clock.now();
    // Once End is pressed the row belongs to finalize: never overwrite it with progress (I1).
    if (
      this.endedAt === null &&
      this.status !== 'FINALIZING' &&
      now - this.lastCheckpointAt >= this.deps.config.checkpointMs
    ) {
      this.enqueueCheckpoint(now);
    }
    this.publish();
  };

  private readonly onVisibilityChange = (visible: boolean): void => {
    if (this.trip === null) return;
    const { clock, config } = this.deps;
    const at = clock.now();
    const gen = this.generation;
    // Boundaries take their sequence number on arrival, so a replay sees them exactly
    // between the samples that arrived before and after (D2).
    const seq = this.nextSeq();

    if (!visible) {
      this.hiddenSince = at;
      this.enqueue(async () => {
        if (gen !== this.generation) return;
        this.proc = applyBoundary(this.proc, { kind: 'PAGE_HIDDEN', at }, config);
        await this.appendEvent('PAGE_HIDDEN', at, null, seq);
      });
      // The page may be frozen or killed from here on: save progress now.
      this.enqueueCheckpoint(at);
      this.publish();
      return;
    }

    const from = this.hiddenSince ?? at;
    this.hiddenSince = null;
    // A screen lock during a user pause loses nothing: it is pause time (review M1).
    if (this.status !== 'PAUSED') this.lastHiddenInterval = { from, to: at };
    // A lease may have expired while the page slept: re-validate before writing more.
    void this.verifyRecorderLock();
    this.acquiringSince = at;
    this.lastResumeAt = at;
    this.enqueue(async () => {
      if (gen !== this.generation) return;
      this.proc = applyBoundary(this.proc, { kind: 'PAGE_VISIBLE', at }, config);
      await this.appendEvent('PAGE_VISIBLE', at, { hiddenMs: at - from }, seq);
    });
    if (
      config.restartWatchOnVisible &&
      (this.status === 'STARTING' || this.status === 'RECORDING')
    ) {
      // Some browsers silently stop delivering after a background period; re-register.
      this.stopWatching();
      void this.beginWatch();
    }
    if (this.wakeWanted) void this.acquireWakeLock();
    this.publish();
  };

  // ---------------------------------------------------------------- wake lock

  private async acquireWakeLock(): Promise<void> {
    const { wakeLock, visibility, clock } = this.deps;
    if (!wakeLock.isSupported()) {
      this.wakeFailed = true;
      this.publish();
      return;
    }
    if (!visibility.isVisible() || wakeLock.isActive()) return;
    const ok = await wakeLock.request();
    if (ok && (!this.wakeWanted || this.trip === null || this.status === 'FINALIZING')) {
      // Turned off / trip ended while the request was pending.
      await wakeLock.release();
      return;
    }
    this.wakeFailed = !ok;
    if (ok && this.trip !== null) this.enqueueEvent('WAKELOCK_ACQUIRED', clock.now(), null);
    this.publish();
  }

  private readonly onWakeLockReleased = (): void => {
    if (this.trip !== null) this.enqueueEvent('WAKELOCK_RELEASED', this.deps.clock.now(), null);
    this.publish();
  };

  private async releaseWakeLockForEnd(at: number): Promise<void> {
    this.detachWakeRelease();
    if (!this.deps.wakeLock.isActive()) return;
    await this.deps.wakeLock.release();
    await this.appendEvent('WAKELOCK_RELEASED', at, { reason: 'END' });
  }

  // ---------------------------------------------------------------- persistence helpers

  private enqueue(task: () => Promise<void>): void {
    const gen = this.generation;
    const guarded = (): Promise<void> => (gen === this.generation ? task() : Promise.resolve());
    this.queue = this.queue.then(guarded).catch((err: unknown) => {
      // Never swallow silently: surface as an internal error in the UI.
      this.internalError = true;
      this.deps.logger?.error(
        `[RouteTrack] tracking task failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.publish();
    });
  }

  private enqueueEvent(
    type: TripEventType,
    timestamp: number,
    metadata: EventMetadata | null,
  ): void {
    const seq = this.nextSeq();
    this.enqueue(() => this.appendEvent(type, timestamp, metadata, seq));
  }

  /** One per-trip counter for GpsPoint.sourceSeq and TripEvent.seq (replay order, D2). */
  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /**
   * Persist an event. Boundaries pass the `seq` taken when they arrived; derived events
   * (gap markers, END, storage errors) take the next number when written.
   */
  private async appendEvent(
    type: TripEventType,
    timestamp: number,
    metadata: EventMetadata | null,
    seq: number = this.nextSeq(),
  ): Promise<void> {
    const trip = this.trip;
    if (trip === null) return;
    try {
      await this.deps.repository.appendEvent({
        id: this.deps.ids.next(),
        tripId: trip.id,
        seq,
        timestamp,
        type,
        metadata,
      });
    } catch {
      this.storageError = true;
      this.publish();
    }
  }

  private async onStorageFailure(operation: string): Promise<void> {
    this.storageError = true;
    this.publish();
    // Best effort: the event write may fail for the same reason (e.g. quota).
    await this.appendEvent('STORAGE_ERROR', this.deps.clock.now(), { operation });
  }

  private async persistTripStatus(
    status: Trip['status'],
    repository: TripRepository,
  ): Promise<void> {
    const trip = this.trip;
    if (trip === null) return;
    this.trip = { ...trip, status, updatedAt: this.deps.clock.now() };
    try {
      await repository.updateTrip(this.trip);
    } catch {
      await this.onStorageFailure('updateTrip');
    }
  }

  private async discardTrip(): Promise<void> {
    const trip = this.trip;
    if (trip === null) return;
    this.trip = null;
    try {
      await this.deps.repository.deleteTripCascade(trip.id);
    } catch {
      this.storageError = true;
    }
  }

  // ---------------------------------------------------------------- state

  private transition(command: TripCommand): void {
    const next = nextStatus(this.status, command);
    if (next === null) {
      throw new Error(`Invalid trip transition ${this.status} --${command}-->`);
    }
    this.status = next;
  }

  private resetSession(): void {
    this.proc = createTrackProcessor(this.deps.config);
    this.seq = 0;
    this.queue = Promise.resolve();
    this.acceptingSamples = false;
    this.cancelRequested = false;
    this.segments = [];
    this.trackDirty = true;
    this.lastFix = null;
    this.hiddenSince = null;
    this.lastResumeAt = null;
    this.lastHiddenInterval = null;
    this.acquiringSince = null;
    this.gpsError = null;
    this.gpsErrorAt = null;
    this.interruptReason = null;
    this.hadInterruption = false;
    this.storageError = false;
    this.internalError = false;
    this.recorderBusy = false;
    this.wakeFailed = false;
    this.endEventsWritten = false;
    this.endedAt = null;
    this.lastCheckpointAt = 0;
  }

  /**
   * Start of the unmeasured tail at End, or null when the last fix is still fresh.
   * After a boundary (visible / continue) with no fix since, the tail starts at that boundary.
   */
  private unresolvedGapStart(lastFixFresh: boolean): number | null {
    const last = this.proc.lastAccepted;
    if (lastFixFresh || last === null) return null;
    if (this.proc.openSegmentId !== null) return last.recordedAt;
    if (this.lastResumeAt !== null && this.lastResumeAt > last.recordedAt) return this.lastResumeAt;
    return null;
  }

  /** Read through methods so TS does not keep a stale narrowing across awaits. */
  private currentTrip(): Trip | null {
    return this.trip;
  }

  private currentStatus(): TripStatus {
    return this.status;
  }

  private wasCancelled(): boolean {
    return this.cancelRequested;
  }

  private updateLastFix(sample: RawGpsSample, outcome: SampleOutcome): void {
    // Show the newest plausible position (accepted, or only rejected for accuracy).
    if (!outcome.accepted && outcome.rejectCode !== 'ACCURACY') return;
    if (!hasValidRange(sample)) return;
    this.lastFix = {
      lat: sample.latitude,
      lng: sample.longitude,
      accuracyM: sample.accuracyM,
      recordedAt: sample.recordedAt,
      accepted: outcome.accepted,
    };
  }

  private appendToTrack(sample: RawGpsSample, outcome: SampleOutcome): void {
    const point: LatLng = { lat: sample.latitude, lng: sample.longitude };
    const current = this.segments.at(-1);
    if (outcome.openedSegment !== null || current === undefined) {
      this.segments.push([point]);
    } else {
      current.push(point);
    }
    this.trackDirty = true;
  }

  private publish(): void {
    if (this.trackDirty) {
      this.trackVersion += 1;
      const lastIndex = this.segments.length - 1;
      // Closed segments are immutable and reused; only the open one is copied.
      this.publishedTrack = {
        version: this.trackVersion,
        segments: this.segments.map((s, i) => (i === lastIndex ? [...s] : s)),
      };
      this.trackDirty = false;
    }
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private computeSignal(now: number): SignalState {
    const { config } = this.deps;
    if (this.trip === null || (this.status !== 'STARTING' && this.status !== 'RECORDING')) {
      return 'NONE';
    }
    if (this.hiddenSince !== null || this.proc.hidden) return 'HIDDEN';
    if (hasFreshFix(this.proc, now, config)) return 'OK';
    const lastAcceptedAt = this.proc.lastAccepted?.recordedAt ?? -Infinity;
    if (this.gpsError !== null && this.gpsErrorAt !== null && this.gpsErrorAt > lastAcceptedAt) {
      return 'ERROR';
    }
    if (this.acquiringSince !== null && now - this.acquiringSince <= config.maxGapMs) {
      return 'ACQUIRING';
    }
    return this.status === 'STARTING' ? 'ACQUIRING' : 'LOST';
  }

  private buildSnapshot(): TrackingSnapshot {
    const { clock, config, wakeLock } = this.deps;
    const now = clock.now();
    const trip = this.trip;
    const proc = this.proc;
    const elapsedMs = trip === null ? 0 : Math.max(0, now - trip.startedAt);
    const recording = this.status === 'RECORDING' && !proc.hidden && this.hiddenSince === null;
    const speedMps = recording ? liveSpeedMps(proc, now, config) : null;
    const first = proc.firstAccepted;

    return {
      status: this.status,
      tripId: trip?.id ?? null,
      tripName: trip?.name ?? null,
      transportMode: trip?.transportMode ?? null,
      startedAt: trip?.startedAt ?? null,
      elapsedMs,
      distanceMeasuredM: proc.distanceMeasuredM,
      currentSpeedKmh: speedMps === null ? null : mpsToKmh(speedMps),
      avgElapsedKmh: avgElapsedKmh(proc.distanceMeasuredM, elapsedMs, proc.measuredEdgeCount),
      signal: this.computeSignal(now),
      lastFix: this.lastFix,
      startPoint: first === null ? null : { lat: first.lat, lng: first.lng },
      rawCount: proc.rawCount,
      acceptedCount: proc.acceptedCount,
      rejectCounts: proc.rejectCounts,
      segmentCount: proc.lastSegmentId,
      gapCount: proc.gapCount,
      hiddenCount: proc.hiddenCount,
      lastHiddenInterval: this.lastHiddenInterval,
      startWaitExceeded:
        this.status === 'STARTING' &&
        trip !== null &&
        now - trip.startedAt > config.startFixTimeoutMs,
      gpsError: this.gpsError,
      interruptReason: this.interruptReason,
      storageError: this.storageError,
      internalError: this.internalError,
      recorderBusy: this.recorderBusy,
      wakeLock: {
        supported: wakeLock.isSupported(),
        wanted: this.wakeWanted,
        active: wakeLock.isActive(),
        failed: this.wakeFailed,
      },
      track: this.publishedTrack,
      lastCompletedTripId: this.lastCompletedTripId,
    };
  }
}

const GPS_ERROR_CODES: ReadonlySet<string> = new Set<GpsErrorCode>([
  'PERMISSION_DENIED',
  'POSITION_UNAVAILABLE',
  'TIMEOUT',
  'UNSUPPORTED',
  'INSECURE_CONTEXT',
]);

function isGpsErrorCode(value: unknown): value is GpsErrorCode {
  return typeof value === 'string' && GPS_ERROR_CODES.has(value);
}

function toGpsError(err: unknown): GpsError {
  if (typeof err === 'object' && err !== null && 'code' in err && isGpsErrorCode(err.code)) {
    const message = 'message' in err && typeof err.message === 'string' ? err.message : err.code;
    return { code: err.code, message };
  }
  return { code: 'POSITION_UNAVAILABLE', message: err instanceof Error ? err.message : 'unknown' };
}
