import { describe, expect, it } from 'vitest';
import {
  calibratedProcessor,
  lastOf,
  ORIGIN,
  seededRandom,
  straightLine,
  T0,
  toSample,
  type SampleSpec,
} from '@/tests/fixtures/gpsFixtures';
import { DEFAULT_GPS_CONFIG, type GpsConfig } from '../models/gpsConfig';
import type { RawGpsSample } from '../models/types';
import { haversineM } from './haversine';
import {
  applyBoundary,
  createTrackProcessor,
  liveSpeedMps,
  processSample,
  type SampleOutcome,
  type TrackProcessorState,
} from './trackProcessor';

const cfg: GpsConfig = DEFAULT_GPS_CONFIG;

interface Run {
  state: TrackProcessorState;
  outcomes: SampleOutcome[];
}

/** Runs on a processor that already calibrated its clock (first real callback of a trip). */
function run(samples: readonly RawGpsSample[], initial = calibratedProcessor(cfg)): Run {
  let state = initial;
  const outcomes: SampleOutcome[] = [];
  for (const s of samples) {
    const r = processSample(state, s, cfg);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes };
}

const samples = (specs: readonly SampleSpec[]): RawGpsSample[] => specs.map((s) => toSample(s));

function sumHaversine(specs: readonly SampleSpec[]): number {
  let total = 0;
  for (let i = 1; i < specs.length; i += 1) {
    const a = specs[i - 1];
    const b = specs[i];
    if (a && b) total += haversineM(a, b);
  }
  return total;
}

describe('STRAIGHT fixture (GPS-001 integration)', () => {
  it('sums Haversine between consecutive accepted samples of one segment', () => {
    const line = straightLine({ count: 61, speedMps: 5 });
    const { state, outcomes } = run(samples(line));
    expect(outcomes.every((o) => o.accepted)).toBe(true);
    expect(state.lastSegmentId).toBe(1);
    expect(state.distanceMeasuredM).toBeCloseTo(sumHaversine(line), 6);
    expect(state.distanceMeasuredM).toBeCloseTo(300, 3); // 60 s × 5 m/s
    expect(state.measuredEdgeCount).toBe(60);
    expect(outcomes[0]?.openedSegment).toEqual({ reason: 'START', gap: null });
    expect(outcomes[0]?.distanceAddedM).toBe(0);
  });
});

describe('GPS-003 time gap (90 s with maxGap 20 s)', () => {
  it('opens a new segment and does not add the A→B bridge', () => {
    const a = straightLine({ count: 5 });
    const b = straightLine({
      count: 5,
      startT: lastOf(a).t + 90_000,
      from: { lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng },
    });
    const { state, outcomes } = run(samples([...a, ...b]));
    const bridge = outcomes[5];
    expect(bridge?.accepted).toBe(true);
    expect(bridge?.distanceAddedM).toBe(0);
    expect(bridge?.segmentId).toBe(2);
    expect(bridge?.openedSegment?.reason).toBe('AFTER_GAP');
    expect(bridge?.openedSegment?.gap?.toSourceTimestamp).toBe(T0 + lastOf(a).t + 90_000);
    expect(state.gapCount).toBe(1);
    expect(state.distanceMeasuredM).toBeCloseTo(sumHaversine(a) + sumHaversine(b), 6);
    // The bridge alone would be > 1 km — it must not be in the total.
    expect(state.distanceMeasuredM).toBeLessThan(100);
  });

  it('keeps a pair exactly at maxGap in the same segment', () => {
    const { state } = run(
      samples([
        { t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng },
        { t: cfg.maxGapMs, lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng },
      ]),
    );
    expect(state.lastSegmentId).toBe(1);
    expect(state.measuredEdgeCount).toBe(1);
  });
});

describe('GPS-005 page hidden / visible', () => {
  it('rejects samples while hidden and starts a new segment after visible, even for a short gap', () => {
    const before = samples(straightLine({ count: 5 }));
    let state = run(before).state;
    const hiddenAt = lastOf(before).recordedAt + 100;
    state = applyBoundary(state, { kind: 'PAGE_HIDDEN', at: hiddenAt }, cfg);

    const whileHidden = processSample(
      state,
      toSample({ t: 5_000, lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng }),
      cfg,
    );
    expect(whileHidden.outcome.rejectCode).toBe('UNTRUSTED');
    state = whileHidden.state;

    const visibleAt = T0 + 8_000;
    state = applyBoundary(state, { kind: 'PAGE_VISIBLE', at: visibleAt }, cfg);
    // Only ~4 s after the last accepted fix (< maxGap) — still a new segment, no bridge.
    const after = processSample(
      state,
      toSample({ t: 8_000, lat: ORIGIN.lat + 0.002, lng: ORIGIN.lng }),
      cfg,
    );
    expect(after.outcome.accepted).toBe(true);
    expect(after.outcome.segmentId).toBe(2);
    expect(after.outcome.openedSegment?.reason).toBe('AFTER_HIDDEN');
    expect(after.outcome.distanceAddedM).toBe(0);
    expect(after.state.distanceMeasuredM).toBeCloseTo(run(before).state.distanceMeasuredM, 9);
    expect(after.state.hiddenCount).toBe(1);
  });

  it('rejects a fix captured before the page became visible as STALE', () => {
    let state = run(samples(straightLine({ count: 2 }))).state;
    state = applyBoundary(state, { kind: 'PAGE_HIDDEN', at: T0 + 2_000 }, cfg);
    state = applyBoundary(state, { kind: 'PAGE_VISIBLE', at: T0 + 30_000 }, cfg);
    const cached = processSample(
      state,
      { ...toSample({ t: 20_000, lat: ORIGIN.lat, lng: ORIGIN.lng }), recordedAt: T0 + 30_100 },
      cfg,
    );
    expect(cached.outcome.rejectCode).toBe('STALE');
  });

  it('a watcher restart (reload recovery) clears a hidden state left by the closed page', () => {
    let state = run(samples(straightLine({ count: 3 }))).state;
    state = applyBoundary(state, { kind: 'PAGE_HIDDEN', at: T0 + 3_000 }, cfg); // tab closed hidden
    state = applyBoundary(state, { kind: 'WATCH_RESTART', at: T0 + 600_000 }, cfg);
    const r = processSample(state, toSample({ t: 600_500, lat: ORIGIN.lat, lng: ORIGIN.lng }), cfg);
    expect(r.outcome.accepted).toBe(true);
    expect(r.outcome.openedSegment?.reason).toBe('AFTER_RESTART');
  });

  it('ignores a duplicate visible boundary (no spurious segment split)', () => {
    const state = run(samples(straightLine({ count: 3 }))).state;
    const same = applyBoundary(state, { kind: 'PAGE_VISIBLE', at: T0 + 5_000 }, cfg);
    expect(same).toBe(state);
  });
});

describe('GPS-007 speed null', () => {
  it('derives speed from displacement/dt when coords.speed is null', () => {
    const line = straightLine({ count: 4, speedMps: 5 });
    const { state, outcomes } = run(samples(line));
    expect(line.every((s) => s.speedMps === null)).toBe(true);
    expect(outcomes[1]?.derivedSpeedMps).toBeCloseTo(5, 6);
    const now = lastOf(line).t + T0 + 500;
    expect(liveSpeedMps(state, now, cfg)).toBeCloseTo(5, 6);
  });
});

describe('GPS-008 duplicate / reversed timestamps', () => {
  const a = { t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng };

  it('rejects an identical sample as DUPLICATE', () => {
    const { outcomes } = run(samples([a, a]));
    expect(outcomes[1]?.rejectCode).toBe('DUPLICATE');
  });

  it('rejects same timestamp with different coordinates as TIMESTAMP', () => {
    const { outcomes } = run(samples([a, { ...a, lat: a.lat + 0.001 }]));
    expect(outcomes[1]?.rejectCode).toBe('TIMESTAMP');
  });

  it('rejects a reversed timestamp and never produces negative/infinite durations', () => {
    const { state, outcomes } = run(
      samples([
        a,
        { t: 2_000, lat: a.lat + 0.0001, lng: a.lng },
        { t: 1_500, lat: a.lat + 0.0002, lng: a.lng },
        { t: 3_000, lat: a.lat + 0.0003, lng: a.lng },
      ]),
    );
    expect(outcomes.map((o) => o.rejectCode)).toEqual([null, null, 'TIMESTAMP', null]);
    for (const o of outcomes) {
      if (o.derivedSpeedMps !== null) {
        expect(Number.isFinite(o.derivedSpeedMps)).toBe(true);
        expect(o.derivedSpeedMps).toBeGreaterThanOrEqual(0);
      }
    }
    expect(state.measuredEdgeCount).toBe(2);
  });

  it('rejects a fix stamped far ahead of the current clock regime', () => {
    const future = { ...toSample({ ...a, t: 2_000 }), sourceTimestamp: T0 + 10 * 60_000 };
    expect(run(samples([a]).concat(future)).outcomes[1]?.rejectCode).toBe('TIMESTAMP');
  });

  it('rejects non-finite timestamps without crashing', () => {
    const bad = { ...toSample(a), sourceTimestamp: Number.NaN };
    expect(run([bad]).outcomes[0]?.rejectCode).toBe('TIMESTAMP');
  });
});

describe('RANGE / ACCURACY / STALE gates', () => {
  it.each<[string, Partial<RawGpsSample>]>([
    ['lat > 90', { latitude: 91 }],
    ['lng < -180', { longitude: -181 }],
    ['NaN lat', { latitude: Number.NaN }],
    ['Null Island (0,0)', { latitude: 0, longitude: 0 }],
    ['accuracy 0', { accuracyM: 0 }],
    ['negative accuracy', { accuracyM: -5 }],
  ])('rejects %s as RANGE', (_name, patch) => {
    const s = { ...toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng }), ...patch };
    expect(run([s]).outcomes[0]?.rejectCode).toBe('RANGE');
  });

  it('accepts accuracy at the threshold and rejects above it, keeping counts', () => {
    const { state, outcomes } = run(
      samples([
        { t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng, accuracyM: 30 },
        { t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng + 0.0001, accuracyM: 30.5 },
        { t: 2_000, lat: ORIGIN.lat, lng: ORIGIN.lng + 0.0002, accuracyM: null },
      ]),
    );
    expect(outcomes.map((o) => o.rejectCode)).toEqual([null, 'ACCURACY', 'ACCURACY']);
    expect(state.rawCount).toBe(4); // + the clock-calibration fix
    expect(state.acceptedCount).toBe(1);
    expect(state.rejectCounts).toEqual({ UNTRUSTED: 1, ACCURACY: 2 });
  });

  it('rejects a fix much older than the clock regime (cached) as STALE', () => {
    const s = { ...toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng }), recordedAt: T0 + 31_000 };
    expect(run([s]).outcomes[0]?.rejectCode).toBe('STALE');
  });

  it('rejects a fix captured before the trip started as STALE', () => {
    const initial = calibratedProcessor(cfg, { startedAt: T0 + 10_000 });
    const s = {
      ...toSample({ t: 5_000, lat: ORIGIN.lat, lng: ORIGIN.lng }),
      recordedAt: T0 + 10_500,
    };
    expect(run([s], initial).outcomes[0]?.rejectCode).toBe('STALE');
  });

  it('does not mutate the previous state object', () => {
    const initial = createTrackProcessor(cfg);
    const snapshot = structuredClone(initial);
    processSample(initial, toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng }), cfg);
    expect(initial).toEqual(snapshot);
  });
});

describe('live speed (median smoothing, §7)', () => {
  it('is null until there are enough edges', () => {
    const line = straightLine({ count: 2 });
    const { state } = run(samples(line));
    expect(liveSpeedMps(state, T0 + 2_000, cfg)).toBeNull();
  });

  it('a single spike that passes the outlier gate does not dominate the live speed', () => {
    // Mid-segment (≥ 3 s of history). In the first seconds of a segment fewer window speeds
    // exist, so one spike can still lift the median briefly (known limitation).
    const line = straightLine({ count: 4, speedMps: 5 });
    // ~52 m in 1 s: under the CAR outlier limit once both accuracy radii are subtracted.
    const spike = { t: 4_000, lat: lastOf(line).lat, lng: lastOf(line).lng + 0.0005 };
    const { state, outcomes } = run(samples([...line, spike]));
    expect(outcomes[4]?.accepted).toBe(true);
    expect(liveSpeedMps(state, T0 + 4_500, cfg)).toBeCloseTo(5, 6);
  });

  it('is null when the last fix is older than liveSpeedMaxAgeMs (never a stale value)', () => {
    const line = straightLine({ count: 4 });
    const { state } = run(samples(line));
    expect(
      liveSpeedMps(state, T0 + lastOf(line).t + cfg.liveSpeedMaxAgeMs + 1_000, cfg),
    ).toBeNull();
  });
});

describe('invariant: no distance across segment boundaries (randomised replay)', () => {
  it('distance never exceeds the within-segment path and segment openings add nothing', () => {
    const random = seededRandom(1234);
    let state = createTrackProcessor(cfg);
    let t = 0;
    let pos = ORIGIN;
    const accepted: { lat: number; lng: number; segmentId: number }[] = [];
    let addedSum = 0;
    for (let i = 0; i < 400; i += 1) {
      const roll = random();
      if (roll < 0.03) state = applyBoundary(state, { kind: 'PAGE_HIDDEN', at: T0 + t }, cfg);
      else if (roll < 0.06) state = applyBoundary(state, { kind: 'PAGE_VISIBLE', at: T0 + t }, cfg);
      t += roll > 0.95 ? 25_000 + random() * 60_000 : 500 + random() * 2_000;
      pos = { lat: pos.lat + (random() - 0.5) * 0.0002, lng: pos.lng + (random() - 0.5) * 0.0002 };
      const r = processSample(
        state,
        toSample({ t, lat: pos.lat, lng: pos.lng, accuracyM: 3 + random() * 35 }),
        cfg,
      );
      state = r.state;
      if (r.outcome.openedSegment !== null) expect(r.outcome.distanceAddedM).toBe(0);
      addedSum += r.outcome.distanceAddedM;
      if (r.outcome.accepted && r.outcome.segmentId !== null) {
        accepted.push({ ...pos, segmentId: r.outcome.segmentId });
      }
    }
    // The drift filter may only drop distance (anchor chords ≤ the path); nothing is bridged.
    let withinSegmentPath = 0;
    for (let i = 1; i < accepted.length; i += 1) {
      const a = accepted[i - 1];
      const b = accepted[i];
      if (a && b && a.segmentId === b.segmentId) withinSegmentPath += haversineM(a, b);
    }
    expect(state.lastSegmentId).toBeGreaterThan(3);
    expect(state.distanceMeasuredM).toBeCloseTo(addedSum, 6);
    expect(state.distanceMeasuredM).toBeLessThanOrEqual(withinSegmentPath + 1e-6);
  });
});

describe('Deferred to M4', () => {
  it.todo('GPS-012 reverse origin/destination not grouped (M4)');
});
