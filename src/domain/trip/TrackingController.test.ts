import { beforeEach, describe, expect, it } from 'vitest';
import { createControllerHarness, type ControllerHarness } from '@/tests/harness';
import { lastOf, ORIGIN, straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { haversineM } from '../geo/haversine';
import { METRICS_VERSION } from '../models/gpsConfig';
import type { TripEventType } from '../models/types';

let h: ControllerHarness;

/** Start a trip and deliver the clock-calibration fix every real trip begins with. */
async function startTrip({ calibrate = true }: { calibrate?: boolean } = {}): Promise<void> {
  h.clock.set(T0);
  await h.controller.start({ name: 'Test', transportMode: 'MOTORBIKE' });
  if (calibrate) await h.calibrate();
}

async function eventTypes(): Promise<TripEventType[]> {
  const tripId =
    h.controller.getSnapshot().tripId ?? h.controller.getSnapshot().lastCompletedTripId;
  if (tripId === null) return [];
  return (await h.repo.listEvents(tripId)).map((e) => e.type);
}

beforeEach(() => {
  h = createControllerHarness();
});

describe('start / STARTING (FR-02, SRS §6)', () => {
  it('creates a STARTING trip, logs START and registers exactly one watcher', async () => {
    await startTrip();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('STARTING');
    expect(s.signal).toBe('ACQUIRING');
    expect(h.geo.watchRegistrations).toBe(1);
    await h.controller.settle();
    expect(await eventTypes()).toEqual(['START']);
    expect((await h.repo.getTrip(s.tripId ?? ''))?.status).toBe('STARTING');
  });

  it('is idempotent: a second Start (double tap / StrictMode) does nothing', async () => {
    await startTrip();
    const first = h.controller.getSnapshot().tripId;
    await h.controller.start({ name: 'Again', transportMode: 'WALK' });
    expect(h.controller.getSnapshot().tripId).toBe(first);
    expect(h.geo.watchRegistrations).toBe(1);
    expect(await h.repo.listTrips()).toHaveLength(1);
  });

  it('stays STARTING on a low-accuracy fix (kept raw) and records on the first good fix', async () => {
    await startTrip();
    await h.emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng, accuracyM: 80 });
    let s = h.controller.getSnapshot();
    expect(s.status).toBe('STARTING');
    expect(s.lastFix?.accepted).toBe(false);
    const tripId = s.tripId ?? '';
    const raw = (await h.repo.listPoints(tripId)).at(-1);
    expect(raw?.accepted).toBe(false);
    expect(raw?.rejectCode).toBe('ACCURACY');

    await h.emit({ t: 2_000, lat: ORIGIN.lat, lng: ORIGIN.lng, accuracyM: 8 });
    s = h.controller.getSnapshot();
    expect(s.status).toBe('RECORDING');
    expect(s.startPoint).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    const trip = await h.repo.getTrip(tripId);
    expect(trip?.status).toBe('RECORDING');
    expect(trip?.startLat).toBe(ORIGIN.lat);
  });

  it('flags the STARTING timeout for UX without auto-cancelling', async () => {
    await startTrip();
    h.clock.advance(h.config.startFixTimeoutMs + 1);
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.startWaitExceeded).toBe(true);
    expect(s.status).toBe('STARTING');
  });

  it('cancelStart deletes the empty trip and stops the watcher', async () => {
    await startTrip();
    await h.emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng, accuracyM: 80 });
    await h.controller.cancelStart();
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.geo.isWatching()).toBe(false);
    expect(await h.repo.listTrips()).toEqual([]);
    expect(h.visibility.listenerCount).toBe(0);
  });

  it('cancel while the trip row is still being created leaves no watcher, listener or orphan row (I3)', async () => {
    let openGate: () => void = () => undefined;
    h.repo.createGate = new Promise((resolve) => {
      openGate = resolve;
    });
    h.clock.set(T0);
    const starting = h.controller.start({ name: 'Slow', transportMode: 'WALK' });
    const cancelling = h.controller.cancelStart();
    openGate();
    await Promise.all([starting, cancelling]);
    await h.controller.settle();
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.geo.isWatching()).toBe(false);
    expect(h.visibility.listenerCount).toBe(0);
    expect(await h.repo.listTrips()).toEqual([]);
  });

  it('a double tap on Hủy is harmless (I3)', async () => {
    await startTrip();
    const results = await Promise.allSettled([
      h.controller.cancelStart(),
      h.controller.cancelStart(),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(h.controller.getSnapshot().status).toBe('IDLE');
  });
});

describe('one recorder per device (RT-206, FR-13)', () => {
  it('start() does nothing but report it when another tab is recording (no trip row)', async () => {
    h.lock.heldByOtherTab = true;
    await startTrip({ calibrate: false });
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('IDLE');
    expect(s.recorderBusy).toBe(true);
    expect(h.geo.isWatching()).toBe(false);
    expect(await h.repo.listTrips()).toEqual([]);
  });

  it('stops recording at once when the recorder lock is lost to another tab (review I4)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    const id = h.controller.getSnapshot().tripId ?? '';
    const pointsBefore = (await h.repo.listPoints(id)).length;
    h.lock.loseLock();
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('IDLE');
    expect(s.recorderBusy).toBe(true);
    expect(h.geo.isWatching()).toBe(false);
    h.geo.emit({
      sourceTimestamp: T0 + 5_000,
      recordedAt: T0 + 5_200,
      latitude: 21.03,
      longitude: 105.85,
      accuracyM: 5,
      speedMps: null,
      headingDeg: null,
    });
    await h.controller.settle();
    expect(await h.repo.listPoints(id)).toHaveLength(pointsBefore);
  });

  it('re-checks the lock when the page becomes visible again (lease may have expired while hidden)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.visibility.setVisible(false);
    h.lock.stillHeldResult = false;
    h.visibility.setVisible(true);
    await h.controller.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.geo.isWatching()).toBe(false);
  });

  it('holds the lock while recording and releases it on End and on cancel', async () => {
    await startTrip();
    expect(h.lock.held).toBe(true);
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.end();
    expect(h.lock.held).toBe(false);

    h.clock.set(T0 + 10_000);
    await h.controller.start({ name: 'again', transportMode: 'WALK' });
    expect(h.lock.held).toBe(true);
    await h.controller.cancelStart();
    expect(h.lock.held).toBe(false);
  });
});

describe('recovery after a reload (FR-12, UC-08, BROWSER_RELOAD)', () => {
  /** Record a trip, then "reload": a fresh controller over the same storage and clock. */
  async function recordThenReload() {
    await startTrip();
    await h.emitAll(straightLine({ count: 5, startT: 1_000, speedMps: 5 }));
    h.clock.set(T0 + 16_000);
    h.timers.tick(); // checkpoint
    await h.controller.settle();
    const before = h.controller.getSnapshot();
    h.clock.set(T0 + 600_000); // the tab was closed for ~10 minutes
    const reloaded = createControllerHarness(undefined, { repo: h.repo, clock: h.clock });
    return { before, reloaded };
  }

  it('refuses a new trip while an unfinished one is waiting to be resolved (BR-01)', async () => {
    const { before, reloaded } = await recordThenReload();
    await reloaded.controller.start({ name: 'second', transportMode: 'WALK' });
    expect(reloaded.controller.getSnapshot().status).toBe('IDLE');
    expect(reloaded.geo.isWatching()).toBe(false);
    expect(reloaded.lock.held).toBe(false);
    const active = await h.repo.listActiveTrips();
    expect(active.map((t) => t.id)).toEqual([before.tripId]);
  });

  it('finds the unfinished trip, unless another tab is recording it', async () => {
    const { before, reloaded } = await recordThenReload();
    expect((await reloaded.controller.findRecoverable())?.id).toBe(before.tripId);
    reloaded.lock.heldByOtherTab = true;
    expect(await reloaded.controller.findRecoverable()).toBeNull();
  });

  it('resume continues in a new segment: no distance or GPS for the closed period', async () => {
    const { before, reloaded } = await recordThenReload();
    const id = before.tripId ?? '';
    await reloaded.controller.resumeRecovered(id);
    let s = reloaded.controller.getSnapshot();
    expect(s.status).toBe('RECORDING');
    expect(s.tripId).toBe(id);
    expect(s.distanceMeasuredM).toBeCloseTo(before.distanceMeasuredM, 6);
    expect(s.track.segments).toHaveLength(1);
    expect(reloaded.geo.isWatching()).toBe(true);

    const far = { lat: ORIGIN.lat + 0.02, lng: ORIGIN.lng };
    // 5 fixes 5 m apart after the reload: 20 m, counted in 10 m anchor steps by the drift filter.
    await reloaded.emitAll(straightLine({ count: 5, startT: 600_500, speedMps: 5, from: far }));
    s = reloaded.controller.getSnapshot();
    expect(s.segmentCount).toBe(2);
    expect(s.distanceMeasuredM).toBeCloseTo(before.distanceMeasuredM + 20, 6);

    const points = await h.repo.listPoints(id);
    const events = await h.repo.listEvents(id);
    const seqs = [...points.map((p) => p.sourceSeq), ...events.map((e) => e.seq)];
    expect(new Set(seqs).size).toBe(seqs.length); // the sequence continued, no reuse
    expect(events.find((e) => e.type === 'RECOVERY')?.metadata).toMatchObject({ reason: 'RELOAD' });
  });

  it('“end” after a reload uses the last persisted activity as endedAt (R1) and is incomplete', async () => {
    const { before, reloaded } = await recordThenReload();
    const id = before.tripId ?? '';
    expect(await reloaded.controller.endRecovered(id)).toBe(id);
    const trip = await h.repo.getTrip(id);
    expect(trip?.status).toBe('COMPLETED');
    expect(trip?.endedAt).toBe(T0 + 16_000); // checkpoint, not the reopen time
    expect(trip?.elapsedMs).toBe(16_000);
    expect(trip?.isIncomplete).toBe(true);
    expect((await h.repo.listEvents(id)).map((e) => e.type)).toContain('END');
    expect(reloaded.lock.held).toBe(false);
  });

  it('a paused trip left INTERRUPTED is restored PAUSED, never RECORDING with GPS ignored (review I2)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 5, startT: 1_000 }));
    h.clock.set(T0 + 6_000);
    await h.controller.pause();
    const id = h.controller.getSnapshot().tripId ?? '';
    const stored = await h.repo.getTrip(id);
    if (stored === undefined) throw new Error('trip missing');
    await h.repo.updateTrip({ ...stored, status: 'INTERRUPTED' });
    h.clock.set(T0 + 100_000);
    const reloaded = createControllerHarness(undefined, { repo: h.repo, clock: h.clock });
    await reloaded.controller.resumeRecovered(id);
    expect(reloaded.controller.getSnapshot().status).toBe('PAUSED');
    expect(reloaded.geo.isWatching()).toBe(false);
  });

  it('“end” after a reload uses the End press time when End had been pressed (review I1)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 5, startT: 1_000 }));
    h.repo.failUpdateTrip = true;
    h.clock.set(T0 + 7_000);
    expect(await h.controller.end()).toBeNull(); // save failed, the user leaves the app
    h.clock.set(T0 + 40_000);
    h.timers.tick();
    await h.controller.settle();
    h.repo.failUpdateTrip = false;
    const id = h.controller.getSnapshot().tripId ?? '';
    const reloaded = createControllerHarness(undefined, { repo: h.repo, clock: h.clock });
    expect(await reloaded.controller.endRecovered(id)).toBe(id);
    expect((await h.repo.getTrip(id))?.endedAt).toBe(T0 + 7_000);
  });

  it('a trip that never got a start fix can only be discarded (D3)', async () => {
    await startTrip();
    h.clock.set(T0 + 30_000);
    const reloaded = createControllerHarness(undefined, { repo: h.repo, clock: h.clock });
    const trip = await reloaded.controller.findRecoverable();
    expect(trip?.startLat).toBeNull();
    expect(await reloaded.controller.endRecovered(trip?.id ?? '')).toBeNull();
    await reloaded.controller.discardRecovered(trip?.id ?? '');
    expect(await h.repo.listTrips()).toEqual([]);
  });

  it('discard refuses a trip that has a start fix (data is never thrown away silently)', async () => {
    const { before, reloaded } = await recordThenReload();
    await reloaded.controller.discardRecovered(before.tripId ?? '');
    expect(await h.repo.getTrip(before.tripId ?? '')).toBeDefined();
  });
});

describe('raw persistence (FR-03, FR-06, docs/05 §10)', () => {
  it('persists every raw sample before recording its processing result, with monotonic sourceSeq', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    const raws = h.repo.calls.filter(
      (c) => c.startsWith('appendRawPoint') || c.startsWith('recordProcessingResult'),
    );
    for (let i = 0; i < raws.length; i += 2) {
      const id = raws[i]?.split(':')[1];
      expect(raws[i]).toBe(`appendRawPoint:${id ?? ''}`);
      expect(raws[i + 1]).toBe(`recordProcessingResult:${id ?? ''}`);
    }
    const points = await h.repo.listPoints(h.controller.getSnapshot().tripId ?? '');
    // Strictly increasing; seq 1 belongs to the START event (shared counter, D2).
    expect(points.map((p) => p.sourceSeq)).toEqual([2, 3, 4, 5]);
    expect(points[0]?.rejectCode).toBe('UNTRUSTED'); // clock calibration
    expect(points.slice(1).every((p) => p.accepted && p.segmentId === 1)).toBe(true);
    expect(points[2]?.derivedSpeedMps).toBeCloseTo(5, 6);
  });

  it('processes samples in arrival order even when storage writes complete out of order (I6)', async () => {
    await startTrip();
    // Later points finish their raw write first, like a busy IndexedDB.
    h.repo.rawWriteDelayMs = (point) => Math.max(0, 30 - point.sourceSeq * 5);
    const line = straightLine({ count: 5, startT: 1_000 });
    for (const spec of line) {
      h.clock.set(T0 + spec.t + 200);
      h.geo.emit({
        sourceTimestamp: T0 + spec.t,
        recordedAt: T0 + spec.t + 200,
        latitude: spec.lat,
        longitude: spec.lng,
        accuracyM: 5,
        speedMps: null,
        headingDeg: null,
      });
    }
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.rejectCounts.TIMESTAMP).toBeUndefined();
    expect(s.acceptedCount).toBe(5);
    expect(s.distanceMeasuredM).toBeCloseTo(20, 6);
  });

  it('on a raw write failure: shows a storage error and does not count the unsaved sample', async () => {
    await startTrip();
    await h.emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    h.repo.failAppendRaw = true;
    await h.emit({ t: 2_000, lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng });
    const s = h.controller.getSnapshot();
    expect(s.storageError).toBe(true);
    expect(s.rawCount).toBe(2); // calibration + first fix; the unsaved one is not counted
    expect(s.distanceMeasuredM).toBe(0);
    expect(h.repo.calls).toContain('appendEvent:STORAGE_ERROR');
  });
});

describe('Pause / Resume (FR-05, UC-03, GPS-004)', () => {
  it('pause stops the watch, logs PAUSE and persists PAUSED', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.pause();
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('PAUSED');
    expect(h.geo.isWatching()).toBe(false);
    expect(s.currentSpeedKmh).toBeNull();
    expect((await h.repo.getTrip(s.tripId ?? ''))?.status).toBe('PAUSED');
    expect(await eventTypes()).toContain('PAUSE');
  });

  it('resume restarts the watch and the next fix opens a new segment without bridging', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.pause();
    h.clock.set(T0 + 124_000);
    await h.controller.resume();
    expect(h.controller.getSnapshot().status).toBe('RECORDING');
    expect(h.geo.isWatching()).toBe(true);
    await h.emitAll(
      straightLine({
        count: 3,
        startT: 124_500,
        from: { lat: ORIGIN.lat + 0.005, lng: ORIGIN.lng },
      }),
    );
    const s = h.controller.getSnapshot();
    expect(s.segmentCount).toBe(2);
    expect(s.distanceMeasuredM).toBeCloseTo(20, 6);
    expect(await eventTypes()).toEqual(['START', 'PAUSE', 'RESUME']);
  });

  it('pause is ignored while STARTING (nothing measured yet)', async () => {
    await startTrip();
    await h.controller.pause();
    expect(h.controller.getSnapshot().status).toBe('STARTING');
    expect(h.geo.isWatching()).toBe(true);
  });

  it('locking the screen while paused shows no “unmeasured” notice (review M1)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.pause();
    h.clock.set(T0 + 10_000);
    h.visibility.setVisible(false);
    h.clock.set(T0 + 300_000);
    h.visibility.setVisible(true);
    await h.controller.settle();
    expect(h.controller.getSnapshot().lastHiddenInterval).toBeNull();
  });

  it('permission revoked while paused keeps the trip PAUSED; after Resume GPS is measured again (review I2)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.pause();
    h.geo.setPermission('denied');
    await h.controller.settle();
    let s = h.controller.getSnapshot();
    expect(s.status).toBe('PAUSED');
    expect(s.gpsError?.code).toBe('PERMISSION_DENIED');

    h.geo.setPermission('granted');
    h.clock.set(T0 + 20_000);
    await h.controller.resume();
    await h.emitAll(
      straightLine({
        count: 5,
        startT: 20_500,
        from: { lat: ORIGIN.lat + 0.003, lng: ORIGIN.lng },
      }),
    );
    s = h.controller.getSnapshot();
    expect(s.status).toBe('RECORDING');
    expect(s.rejectCounts.UNTRUSTED ?? 0).toBe(1); // only the clock-calibration fix
    expect(s.distanceMeasuredM).toBeCloseTo(30, 6); // 10 m before the pause + 20 m after
  });

  it('End while PAUSED completes and does not log a GPS gap for the pause', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    await h.controller.pause();
    h.clock.set(T0 + 90_000);
    const id = await h.controller.end();
    expect((await h.repo.getTrip(id ?? ''))?.status).toBe('COMPLETED');
    const types = (await h.repo.listEvents(id ?? '')).map((e) => e.type);
    expect(types).toEqual(['START', 'PAUSE', 'END']);
  });
});

describe('transport mode', () => {
  it('the live outlier gate uses the trip mode (WALK rejects 25 km/h jumps), like the replay', async () => {
    h.clock.set(T0);
    await h.controller.start({ name: 'walk', transportMode: 'WALK' });
    await h.calibrate();
    await h.emitAll(straightLine({ count: 6, startT: 1_000, speedMps: 25 / 3.6, accuracyM: 1 }));
    expect(h.controller.getSnapshot().rejectCounts.OUTLIER ?? 0).toBeGreaterThan(0);
  });
});

describe('replay order (D2)', () => {
  it('events and points share one strictly increasing sequence, in arrival order', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    h.visibility.setVisible(false);
    await h.emit({ t: 5_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    h.clock.set(T0 + 9_000);
    h.visibility.setVisible(true);
    await h.emitAll(straightLine({ count: 2, startT: 9_500 }));
    const tripId = h.controller.getSnapshot().tripId ?? '';
    const points = await h.repo.listPoints(tripId);
    const events = await h.repo.listEvents(tripId);
    const all = [
      ...points.map((p) => ({ seq: p.sourceSeq, what: `point@${p.recordedAt - T0}` })),
      ...events.map((e) => ({ seq: e.seq, what: e.type })),
    ].sort((a, b) => a.seq - b.seq);
    expect(new Set(all.map((x) => x.seq)).size).toBe(all.length);
    expect(all.map((x) => x.what)).toEqual([
      'START',
      'point@700',
      'point@1200',
      'point@2200',
      'point@3200',
      'PAGE_HIDDEN',
      'point@5200',
      'PAGE_VISIBLE',
      'point@9700',
      'point@10700',
    ]);
  });
});

describe('AC-04 / GPS-005: hidden → visible makes two segments without bridging', () => {
  it('splits the track, rejects hidden-time callbacks and logs PAGE_HIDDEN/PAGE_VISIBLE', async () => {
    await startTrip();
    const first = straightLine({ count: 5, startT: 1_000, speedMps: 5 });
    await h.emitAll(first);

    h.clock.set(T0 + 6_000);
    h.visibility.setVisible(false);
    await h.controller.settle();
    expect(h.controller.getSnapshot().signal).toBe('HIDDEN');
    // Some browsers still deliver a callback while hidden: kept raw, never trusted.
    await h.emit({ t: 7_000, lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng });

    h.clock.set(T0 + 12_000);
    h.visibility.setVisible(true);
    await h.controller.settle();
    const second = straightLine({
      count: 5,
      startT: 12_500,
      from: { lat: ORIGIN.lat + 0.002, lng: ORIGIN.lng },
    });
    await h.emitAll(second);

    const s = h.controller.getSnapshot();
    expect(s.segmentCount).toBe(2);
    expect(s.track.segments).toHaveLength(2);
    expect(s.rejectCounts.UNTRUSTED).toBe(2); // calibration + the callback received while hidden
    expect(s.hiddenCount).toBe(1);
    expect(s.lastHiddenInterval).toEqual({ from: T0 + 6_000, to: T0 + 12_000 });
    const bridge = haversineM(lastOf(first), second[0] ?? lastOf(second));
    expect(bridge).toBeGreaterThan(200);
    expect(s.distanceMeasuredM).toBeCloseTo(40, 6); // 20 m + 20 m, bridge excluded
    expect(await eventTypes()).toEqual(['START', 'PAGE_HIDDEN', 'PAGE_VISIBLE']);
    // Watcher re-registered on visible, but never duplicated.
    expect(h.geo.isWatching()).toBe(true);
    expect(h.geo.watchRegistrations).toBe(2);
  });
});

describe('GPS-003: time gap during recording', () => {
  it('logs GPS_GAP_BEGIN/END and adds no distance across the gap', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 30_000);
    await h.controller.settle();
    expect(h.controller.getSnapshot().signal).toBe('LOST');
    await h.emit({ t: 93_000, lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng });
    const s = h.controller.getSnapshot();
    expect(s.gapCount).toBe(1);
    expect(s.segmentCount).toBe(2);
    expect(s.distanceMeasuredM).toBeCloseTo(10, 6);
    expect(s.signal).toBe('OK');
    expect(await eventTypes()).toEqual(['START', 'GPS_GAP_BEGIN', 'GPS_GAP_END']);
  });
});

describe('GPS errors (FR-15, NFR-10)', () => {
  it('PERMISSION_DENIED while STARTING: no trip is created, back to IDLE with the error', async () => {
    await startTrip();
    h.geo.emitError({ code: 'PERMISSION_DENIED', message: 'denied' });
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('IDLE');
    expect(s.gpsError?.code).toBe('PERMISSION_DENIED');
    expect(await h.repo.listTrips()).toEqual([]);
    expect(h.geo.isWatching()).toBe(false);
  });

  it('PERMISSION_DENIED while RECORDING → INTERRUPTED; continue opens a new segment; End is incomplete', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    h.geo.emitError({ code: 'PERMISSION_DENIED', message: 'revoked' });
    await h.controller.settle();
    let s = h.controller.getSnapshot();
    expect(s.status).toBe('INTERRUPTED');
    expect(s.interruptReason).toBe('GPS_FATAL');
    expect((await h.repo.getTrip(s.tripId ?? ''))?.status).toBe('INTERRUPTED');
    expect(h.geo.isWatching()).toBe(false);

    h.clock.set(T0 + 5_000);
    await h.controller.continueAfterInterruption();
    await h.emitAll(
      straightLine({ count: 3, startT: 6_000, from: { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng } }),
    );
    s = h.controller.getSnapshot();
    expect(s.status).toBe('RECORDING');
    expect(s.segmentCount).toBe(2);
    expect(s.distanceMeasuredM).toBeCloseTo(20, 6);

    h.clock.set(T0 + 9_000);
    const id = await h.controller.end();
    const trip = await h.repo.getTrip(id ?? '');
    expect(trip?.status).toBe('COMPLETED');
    expect(trip?.isIncomplete).toBe(true);
    expect(await eventTypes()).toContain('RECOVERY');
  });

  it('permission revoked without a watch error (Permissions API → denied) interrupts recording', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 2, startT: 1_000 }));
    h.geo.setPermission('denied');
    await h.controller.settle();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('INTERRUPTED');
    expect(s.gpsError?.code).toBe('PERMISSION_DENIED');
    expect(h.geo.isWatching()).toBe(false);
  });

  it('TIMEOUT is non-fatal: keeps RECORDING, signal ERROR, cleared by the next fix', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 2, startT: 1_000 }));
    h.clock.set(T0 + 25_000);
    h.geo.emitError({ code: 'TIMEOUT', message: 'timeout' });
    await h.controller.settle();
    let s = h.controller.getSnapshot();
    expect(s.status).toBe('RECORDING');
    expect(s.signal).toBe('ERROR');
    await h.emit({ t: 26_000, lat: ORIGIN.lat, lng: ORIGIN.lng + 0.001 });
    s = h.controller.getSnapshot();
    expect(s.gpsError).toBeNull();
    expect(s.signal).toBe('OK');
    expect(await eventTypes()).toContain('GPS_ERROR');
  });

  it('a watcher that cannot start (insecure context) aborts STARTING', async () => {
    h.geo.startWatchError = { code: 'INSECURE_CONTEXT', message: 'https' };
    await startTrip();
    await h.controller.settle();
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.controller.getSnapshot().gpsError?.code).toBe('INSECURE_CONTEXT');
  });

  it('unsupported geolocation never starts a trip', async () => {
    h.geo.supported = false;
    await startTrip();
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.controller.getSnapshot().gpsError?.code).toBe('UNSUPPORTED');
    expect(await h.repo.listTrips()).toEqual([]);
  });
});

describe('End / FINALIZING (FR-05, UC-04)', () => {
  it('stops the watcher, stores the analytics summary and returns to IDLE', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 11, startT: 1_000, speedMps: 5 }));
    h.clock.set(T0 + 12_000);
    const id = await h.controller.end();
    expect(id).not.toBeNull();
    expect(h.geo.isWatching()).toBe(false);
    expect(h.visibility.listenerCount).toBe(0);
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('IDLE');
    expect(s.lastCompletedTripId).toBe(id);

    const trip = await h.repo.getTrip(id ?? '');
    expect(trip?.status).toBe('COMPLETED');
    expect(trip?.elapsedMs).toBe(12_000);
    expect(trip?.distanceMeasuredM).toBeCloseTo(50, 6);
    expect(trip?.avgElapsedKmh).toBeCloseTo((50 / 12) * 3.6, 6);
    expect(trip?.isIncomplete).toBe(false);
    expect(trip?.endLat).not.toBeNull();
    // Full docs/05 summary from the persisted raw data (analyzeTrip).
    expect(trip?.metricsVersion).toBe(METRICS_VERSION);
    expect(trip?.movingMs).toBeGreaterThan(9_000);
    expect(trip?.coveragePct).toBeGreaterThan(80);
    expect(trip?.qualityLabel).not.toBeNull();
    expect(trip?.avgMovingKmh).toBeCloseTo(18, 0);
    // 10 s is too short for full smoothing windows: min/max are “—”, never guessed.
    expect(trip?.minSpeedKmh).toBeNull();
    expect(await eventTypes()).toEqual(['START', 'END']);

    // Late callbacks after End are ignored.
    h.geo.emit({
      sourceTimestamp: T0 + 13_000,
      recordedAt: T0 + 13_000,
      latitude: 1,
      longitude: 1,
      accuracyM: 5,
      speedMps: null,
      headingDeg: null,
    });
    await h.controller.settle();
    expect(await h.repo.listPoints(id ?? '')).toHaveLength(12); // calibration + 11
  });

  it('checkpoints trip progress every 15 s and when the page hides (recovery needs it)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 5, startT: 1_000 }));
    const tripId = h.controller.getSnapshot().tripId ?? '';
    h.clock.set(T0 + 16_000);
    h.timers.tick();
    await h.controller.settle();
    let row = await h.repo.getTrip(tripId);
    expect(row?.updatedAt).toBe(T0 + 16_000);
    expect(row?.distanceMeasuredM).toBeCloseTo(20, 6);
    expect(row?.elapsedMs).toBe(16_000);
    h.clock.set(T0 + 18_000);
    h.visibility.setVisible(false);
    await h.controller.settle();
    row = await h.repo.getTrip(tripId);
    expect(row?.updatedAt).toBe(T0 + 18_000);
  });

  it('a finalize stuck longer than finalizeTimeoutMs fails safely and keeps the track', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.repo.updateGate = new Promise(() => undefined); // IndexedDB never answers
    h.clock.set(T0 + 4_000);
    const ending = h.controller.end();
    await Promise.resolve();
    await h.controller.settle();
    h.timers.fireTimeouts();
    expect(await ending).toBeNull();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('INTERRUPTED');
    expect(s.interruptReason).toBe('FINALIZE_FAILED');
    expect(await h.repo.listPoints(s.tripId ?? '')).toHaveLength(4);
  });

  it('END_WITHOUT_FIX: no fabricated endpoint, incomplete, open gap recorded', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 60_000);
    const id = await h.controller.end();
    const trip = await h.repo.getTrip(id ?? '');
    expect(trip?.endLat).toBeNull();
    expect(trip?.endLng).toBeNull();
    expect(trip?.isIncomplete).toBe(true);
    expect(trip?.elapsedMs).toBe(60_000); // time still measured Start→End
    const events = await h.repo.listEvents(id ?? '');
    expect(events.find((e) => e.type === 'GPS_GAP_BEGIN')?.metadata).toEqual({
      unresolvedAtEnd: true,
    });
  });

  it('End right after returning from a hidden page (no fix since) records the unresolved gap', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.clock.set(T0 + 4_000);
    h.visibility.setVisible(false);
    h.clock.set(T0 + 40_000);
    h.visibility.setVisible(true);
    await h.controller.settle();
    h.clock.set(T0 + 70_000);
    const id = await h.controller.end();
    const events = await h.repo.listEvents(id ?? '');
    const gap = events.find((e) => e.type === 'GPS_GAP_BEGIN');
    expect(gap?.metadata).toEqual({ unresolvedAtEnd: true });
    expect(gap?.timestamp).toBe(T0 + 40_000);
    expect((await h.repo.getTrip(id ?? ''))?.endLat).toBeNull();
  });

  it('a save that times out but succeeds late is adopted and never overwritten by a checkpoint (review I1)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 5, startT: 1_000 }));
    let openGate: () => void = () => undefined;
    h.repo.updateGate = new Promise((resolve) => {
      openGate = resolve;
    });
    h.clock.set(T0 + 7_000);
    const ending = h.controller.end();
    await Promise.resolve();
    await h.controller.settle();
    h.timers.fireTimeouts();
    expect(await ending).toBeNull();
    const id = h.controller.getSnapshot().tripId ?? '';

    h.repo.updateGate = null;
    openGate(); // the slow transaction finally commits
    await h.controller.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.controller.getSnapshot().status).toBe('IDLE');
    expect(h.controller.getSnapshot().lastCompletedTripId).toBe(id);

    h.clock.set(T0 + 30_000);
    h.timers.tick();
    await h.controller.settle();
    const row = await h.repo.getTrip(id);
    expect(row?.status).toBe('COMPLETED');
    expect(row?.endedAt).toBe(T0 + 7_000);
    expect(row?.metricsVersion).toBe(METRICS_VERSION);
  });

  it('a failed finalize keeps the track, goes INTERRUPTED and can be retried without duplicate END', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.repo.failUpdateTrip = true;
    h.clock.set(T0 + 4_000);
    expect(await h.controller.end()).toBeNull();
    const s = h.controller.getSnapshot();
    expect(s.status).toBe('INTERRUPTED');
    expect(s.interruptReason).toBe('FINALIZE_FAILED');
    const tripId = s.tripId ?? '';
    expect(await h.repo.listPoints(tripId)).toHaveLength(4); // calibration + 3

    h.repo.failUpdateTrip = false;
    const id = await h.controller.end();
    expect(id).toBe(tripId);
    const types = (await h.repo.listEvents(tripId)).map((e) => e.type);
    expect(types.filter((t) => t === 'END')).toHaveLength(1);
    expect((await h.repo.getTrip(tripId))?.isIncomplete).toBe(true);
  });

  it('End is not allowed while STARTING (no COMPLETED trip without a start fix)', async () => {
    await startTrip();
    expect(await h.controller.end()).toBeNull();
    expect(h.controller.getSnapshot().status).toBe('STARTING');
  });
});

describe('Wake Lock (FR-16, AC-10)', () => {
  it('acquires on request, logs release by the system, re-acquires when visible, releases on End', async () => {
    await startTrip();
    await h.emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    await h.controller.setKeepScreenOn(true);
    expect(h.controller.getSnapshot().wakeLock).toMatchObject({
      wanted: true,
      active: true,
      failed: false,
    });

    h.clock.set(T0 + 2_000);
    h.wakeLock.systemRelease();
    h.visibility.setVisible(false);
    await h.controller.settle();
    expect(h.controller.getSnapshot().wakeLock.active).toBe(false);

    h.clock.set(T0 + 3_000);
    h.visibility.setVisible(true);
    await h.controller.settle();
    expect(h.wakeLock.requestCount).toBe(2);
    expect(h.controller.getSnapshot().wakeLock.active).toBe(true);

    const id = await h.controller.end();
    expect(h.wakeLock.isActive()).toBe(false);
    const types = (await h.repo.listEvents(id ?? '')).map((e) => e.type);
    expect(types.filter((t) => t === 'WAKELOCK_ACQUIRED')).toHaveLength(2);
    expect(types.filter((t) => t === 'WAKELOCK_RELEASED')).toHaveLength(2);
  });

  it('turning it off while a request is still pending never leaves the screen lock on', async () => {
    await startTrip();
    h.wakeLock.deferRequests = true;
    const turningOn = h.controller.setKeepScreenOn(true);
    await h.controller.setKeepScreenOn(false);
    h.wakeLock.resolvePending();
    await turningOn;
    await h.controller.settle();
    expect(h.wakeLock.isActive()).toBe(false);
    expect(h.controller.getSnapshot().wakeLock.active).toBe(false);
  });

  it('ending while a request is still pending never leaves the screen lock on', async () => {
    await startTrip();
    await h.emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    h.wakeLock.deferRequests = true;
    const turningOn = h.controller.setKeepScreenOn(true);
    await h.controller.end();
    h.wakeLock.resolvePending();
    await turningOn;
    expect(h.wakeLock.isActive()).toBe(false);
  });

  it('degrades gracefully when the API is missing or the request is refused', async () => {
    h.wakeLock.supported = false;
    await startTrip();
    await h.controller.setKeepScreenOn(true);
    expect(h.controller.getSnapshot().wakeLock).toMatchObject({
      supported: false,
      active: false,
      failed: true,
    });

    const h2 = createControllerHarness();
    h2.wakeLock.denyRequests = true;
    await h2.controller.start({ name: 'x', transportMode: 'WALK' });
    await h2.controller.setKeepScreenOn(true);
    expect(h2.controller.getSnapshot().wakeLock).toMatchObject({
      supported: true,
      active: false,
      failed: true,
    });
    expect(h2.controller.getSnapshot().status).toBe('STARTING');
  });
});

describe('live snapshot (NFR-09, BR-07)', () => {
  it('shows “no data” (null) for speeds until there is evidence', async () => {
    await startTrip();
    const line = straightLine({ count: 4, startT: 1_000, speedMps: 5 });
    await h.emitAll(line.slice(0, 1));
    let s = h.controller.getSnapshot();
    expect(s.currentSpeedKmh).toBeNull();
    expect(s.avgElapsedKmh).toBeNull();
    await h.emitAll(line.slice(1));
    s = h.controller.getSnapshot();
    expect(s.currentSpeedKmh).toBeCloseTo(18, 6);
    expect(s.avgElapsedKmh).not.toBeNull();
  });

  it('reuses closed segment arrays across publishes (cheap map redraw)', async () => {
    await startTrip();
    await h.emitAll(straightLine({ count: 3, startT: 1_000 }));
    h.visibility.setVisible(false);
    h.visibility.setVisible(true);
    await h.emitAll(
      straightLine({
        count: 2,
        startT: 10_000,
        from: { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng },
      }),
    );
    const a = h.controller.getSnapshot().track;
    await h.emit({ t: 12_000, lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng + 0.0002 });
    const b = h.controller.getSnapshot().track;
    expect(b.version).toBeGreaterThan(a.version);
    expect(b.segments[0]).toBe(a.segments[0]);
    expect(b.segments[1]).not.toBe(a.segments[1]);
    expect(b.segments[1]).toHaveLength(3);
  });

  it('notifies subscribers on publish and stops after unsubscribe', async () => {
    let calls = 0;
    const unsubscribe = h.controller.subscribe(() => {
      calls += 1;
    });
    await startTrip();
    const afterStart = calls;
    expect(afterStart).toBeGreaterThan(0);
    unsubscribe();
    await h.controller.settle();
    expect(calls).toBe(afterStart);
  });
});
