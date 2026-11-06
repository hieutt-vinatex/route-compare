/**
 * Drift and outlier filters (docs/05 §3.6–§3.7, RT-203): GPS-002, GPS-006 + live speed.
 */
import { describe, expect, it } from 'vitest';
import {
  calibratedProcessor,
  lastOf,
  ORIGIN,
  stationaryJitter,
  straightLine,
  T0,
  toSample,
  type SampleSpec,
} from '@/tests/fixtures/gpsFixtures';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import type { TransportMode } from '../models/types';
import { destinationPoint, haversineM } from './haversine';
import {
  applyBoundary,
  liveSpeedMps,
  processSample,
  type SampleOutcome,
  type TrackProcessorState,
} from './trackProcessor';

function run(specs: readonly SampleSpec[], transportMode: TransportMode = 'MOTORBIKE') {
  let state: TrackProcessorState = calibratedProcessor(cfg, { transportMode });
  const outcomes: SampleOutcome[] = [];
  for (const spec of specs) {
    const r = processSample(state, toSample(spec), cfg);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes };
}

const pathLength = (specs: readonly SampleSpec[]): number =>
  specs.slice(1).reduce((sum, s, i) => sum + haversineM(specs[i] ?? s, s), 0);

describe('GPS-002 stationary jitter (drift filter)', () => {
  it('5 minutes standing still with ≤ 4 m jitter (accuracy 8 m) adds < 5 m', () => {
    const still = stationaryJitter({ count: 300, radiusM: 4, accuracyM: 8 });
    const { state } = run(still);
    expect(state.acceptedCount).toBe(300);
    expect(state.distanceMeasuredM).toBeLessThan(5);
  });

  it('shows (almost) no current speed while standing still', () => {
    const still = stationaryJitter({ count: 60, radiusM: 4, accuracyM: 8 });
    const { state } = run(still);
    const now = T0 + 59_000 + 500;
    expect(liveSpeedMps(state, now, cfg)).toBe(0);
  });
});

describe('STRAIGHT with the drift filter', () => {
  it('keeps the measured distance within 1 % of the true path', () => {
    const line = straightLine({ count: 101, speedMps: 5, accuracyM: 5 });
    const { state } = run(line);
    expect(Math.abs(state.distanceMeasuredM - pathLength(line)) / pathLength(line)).toBeLessThan(
      0.01,
    );
  });

  it('a slow walk with poor accuracy is still counted (anchor catches up)', () => {
    const walk = straightLine({ count: 121, speedMps: 1.2, accuracyM: 15 });
    const { state } = run(walk, 'WALK');
    expect(state.distanceMeasuredM / pathLength(walk)).toBeGreaterThan(0.85);
  });
});

describe('GPS-006 speed outlier', () => {
  it('a 1 km jump in 2 s is OUTLIER and the next normal fix continues the segment', () => {
    const line = straightLine({ count: 10, speedMps: 5 });
    const last = line.at(-1) ?? line[0]!;
    const spike = destinationPoint(last, 0, 1_000);
    const after = straightLine({
      count: 5,
      speedMps: 5,
      startT: 11_000,
      from: destinationPoint(ORIGIN, 90, 55),
    });
    const { state, outcomes } = run([
      ...line,
      { t: 10_000, lat: spike.lat, lng: spike.lng, accuracyM: 5 },
      ...after,
    ]);
    expect(outcomes[10]?.rejectCode).toBe('OUTLIER');
    expect(outcomes.slice(11).every((o) => o.accepted && o.segmentId === 1)).toBe(true);
    expect(state.distanceMeasuredM).toBeLessThan(100);
  });

  it('the limit depends on the transport mode (25 km/h: WALK rejects, CAR accepts)', () => {
    const fast = straightLine({ count: 6, speedMps: 25 / 3.6, accuracyM: 1 });
    expect(run(fast, 'WALK').outcomes.some((o) => o.rejectCode === 'OUTLIER')).toBe(true);
    expect(run(fast, 'CAR').outcomes.some((o) => o.rejectCode === 'OUTLIER')).toBe(false);
  });

  it('a lasting relocation is not rejected forever: after maxGap a new segment starts, no bridge', () => {
    const before = straightLine({ count: 5, speedMps: 5 });
    const far = destinationPoint(ORIGIN, 0, 2_000);
    const there = straightLine({ count: 30, speedMps: 1, startT: 5_000, from: far });
    const { state, outcomes } = run([...before, ...there], 'WALK');
    const opened = outcomes.findIndex((o) => o.openedSegment?.reason === 'AFTER_GAP');
    expect(opened).toBeGreaterThan(5);
    expect(outcomes[opened]?.distanceAddedM).toBe(0);
    expect(state.lastSegmentId).toBe(2);
    expect(state.distanceMeasuredM).toBeLessThan(60);
  });
});

describe('live speed', () => {
  it('prefers the provider speed (coords.speed) when the device reports it', () => {
    const line = straightLine({ count: 6, speedMps: 5, reportSpeed: true }).map((s) => ({
      ...s,
      speedMps: 8, // provider says 8 m/s (Doppler), positions say 5 m/s
    }));
    const { state } = run(line);
    expect(liveSpeedMps(state, T0 + 5_500, cfg)).toBeCloseTo(8, 6);
  });

  it('falls back to displacement over the last seconds when speed is null', () => {
    const line = straightLine({ count: 8, speedMps: 5 });
    const { state } = run(line);
    expect(liveSpeedMps(state, T0 + 7_500, cfg)).toBeCloseTo(5, 1);
  });

  // BR-07: 0 km/h only for a confirmed stop; movement still inside the uncertainty is "—".
  it('reads null ("—"), not 0, while slow walking is still inside the position uncertainty', () => {
    // 1.2 m/s at 15 m accuracy: 7 s cover 8.4 m, less than the 21 m combined uncertainty.
    const walk = straightLine({ count: 8, speedMps: 1.2, accuracyM: 15 });
    const { state } = run(walk, 'WALK');
    expect(liveSpeedMps(state, T0 + 7_500, cfg)).toBeNull();
  });

  it('measures slow walking over a longer base once it leaves the uncertainty', () => {
    const walk = straightLine({ count: 25, speedMps: 1.2, accuracyM: 15 });
    const { state } = run(walk, 'WALK');
    expect(liveSpeedMps(state, T0 + 24_500, cfg)).toBeCloseTo(1.2, 1);
  });

  it('reads 0 only once a stop is confirmed over the dwell time', () => {
    const shortStop = run(stationaryJitter({ count: 10, radiusM: 4, accuracyM: 8 })).state;
    expect(liveSpeedMps(shortStop, T0 + 9_500, cfg)).toBeNull();
    const longStop = run(stationaryJitter({ count: 20, radiusM: 4, accuracyM: 8 })).state;
    expect(liveSpeedMps(longStop, T0 + 19_500, cfg)).toBe(0);
  });

  it('a walk that just stopped is not 0 before the dwell confirms the stop', () => {
    const walk = straightLine({ count: 20, speedMps: 1.5, accuracyM: 8 });
    const end = lastOf(walk);
    const still = stationaryJitter({
      count: 6,
      startT: end.t + 1_000,
      radiusM: 2,
      accuracyM: 8,
      center: { lat: end.lat, lng: end.lng },
    });
    const { state } = run([...walk, ...still], 'WALK');
    expect(liveSpeedMps(state, T0 + lastOf(still).t + 500, cfg)).not.toBe(0);
  });
});

describe('GPS-004 pause', () => {
  it('a 120 s pause adds no distance across it and resumes in a new segment', () => {
    const before = straightLine({ count: 5, speedMps: 5 });
    let { state } = run(before);
    state = applyBoundary(state, { kind: 'PAUSE', at: T0 + 4_500 }, cfg);
    // A callback still in flight while paused is never measured.
    const inFlight = processSample(
      state,
      toSample({ t: 5_000, lat: ORIGIN.lat, lng: ORIGIN.lng }),
      cfg,
    );
    expect(inFlight.outcome.rejectCode).toBe('UNTRUSTED');
    state = applyBoundary(inFlight.state, { kind: 'RESUME', at: T0 + 124_500 }, cfg);
    const far = destinationPoint(ORIGIN, 90, 600);
    const after = straightLine({ count: 3, speedMps: 5, startT: 125_000, from: far });
    let total = state.distanceMeasuredM;
    const outcomes: SampleOutcome[] = [];
    for (const spec of after) {
      const r = processSample(state, toSample(spec), cfg);
      state = r.state;
      outcomes.push(r.outcome);
    }
    total = state.distanceMeasuredM - total;
    expect(outcomes[0]?.openedSegment?.reason).toBe('AFTER_PAUSE');
    expect(outcomes[0]?.distanceAddedM).toBe(0);
    expect(total).toBeCloseTo(10, 6);
    expect(state.distanceMeasuredM).toBeCloseTo(30, 6);
  });
});
