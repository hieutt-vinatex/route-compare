/**
 * CLOCK_ERROR replay fixtures (docs/05 §11, review I1/I2).
 *
 * Two clocks are involved: the fix time (GeolocationPosition.timestamp — may be GNSS time or
 * another provider clock) and the app clock when the callback arrives (recordedAt).
 * Their difference (offset) is normally small and stable, but may be large on some devices.
 */
import { describe, expect, it } from 'vitest';
import { ORIGIN, T0 } from '@/tests/fixtures/gpsFixtures';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import type { RawGpsSample } from '../models/types';
import { destinationPoint } from './haversine';
import {
  applyBoundary,
  createTrackProcessor,
  processSample,
  type SampleOutcome,
  type TrackProcessorState,
} from './trackProcessor';

/** Device moving east at 10 m/s; position at real time t (ms). */
const at = (t: number) => destinationPoint(ORIGIN, 90, (10 * t) / 1000);

/**
 * A fix truly captured at real time `t`, stamped with `t + stampSkew`,
 * received by the app at `t + 200 + deliveryDelay`.
 */
function fix(t: number, stampSkew = 0, deliveryDelay = 0): RawGpsSample {
  const p = at(t);
  return {
    sourceTimestamp: T0 + t + stampSkew,
    recordedAt: T0 + t + 200 + deliveryDelay,
    latitude: p.lat,
    longitude: p.lng,
    accuracyM: 5,
    speedMps: null,
    headingDeg: null,
  };
}

function feed(state: TrackProcessorState, samples: readonly RawGpsSample[]) {
  let s = state;
  const outcomes: SampleOutcome[] = [];
  for (const sample of samples) {
    const r = processSample(s, sample, cfg);
    s = r.state;
    outcomes.push(r.outcome);
  }
  return { state: s, outcomes };
}

const seconds = (from: number, to: number, f: (t: number) => RawGpsSample) =>
  Array.from({ length: to - from + 1 }, (_, i) => f((from + i) * 1000));

describe('CLOCK_ERROR: device clock skew', () => {
  it.each([-45_000, 45_000, -10 * 60_000])(
    'a constant offset of %d ms between fix time and app clock does not block recording',
    (skew) => {
      const { state, outcomes } = feed(
        createTrackProcessor(cfg, { startedAt: T0 }),
        seconds(0, 60, (t) => fix(t, skew)),
      );
      expect(outcomes.filter((o) => o.rejectCode === 'STALE')).toHaveLength(0);
      expect(outcomes.filter((o) => o.rejectCode === 'TIMESTAMP')).toHaveLength(0);
      expect(state.acceptedCount).toBeGreaterThanOrEqual(60);
      expect(state.lastSegmentId).toBe(1);
    },
  );
});

describe('CLOCK_ERROR: one future-stamped fix', () => {
  it('is rejected as TIMESTAMP, does not become the ordering anchor and adds no bridge', () => {
    const before = seconds(0, 10, (t) => fix(t));
    const glitch = fix(11_000, 240_000); // stamped 4 min in the future
    const after = seconds(12, 30, (t) => fix(t));
    const { state, outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [
      ...before,
      glitch,
      ...after,
    ]);
    expect(outcomes[11]?.rejectCode).toBe('TIMESTAMP');
    expect(outcomes.slice(12).every((o) => o.accepted)).toBe(true);
    expect(state.lastSegmentId).toBe(1);
    // ~10 m/s × 29 s of accepted, continuous fixes (first fix only calibrates the clock).
    expect(state.distanceMeasuredM).toBeGreaterThan(280);
    expect(state.distanceMeasuredM).toBeLessThan(300);
  });
});

describe('CLOCK_ERROR: late delivery', () => {
  it('a fix delivered 25 s late is STALE and never joined to the track', () => {
    const before = seconds(0, 10, (t) => fix(t));
    const late = fix(11_000, 0, 25_000);
    const { state, outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [
      ...before,
      late,
    ]);
    expect(outcomes[11]?.rejectCode).toBe('STALE');
    expect(state.measuredEdgeCount).toBe(9);
  });

  it('opens a new segment when the app received nothing for > maxGap, even if fix times are closer', () => {
    // Fix times 18 s apart (< maxGap) but the app clock says 22 s passed (> maxGap).
    const a = fix(0);
    const b = fix(1_000);
    const c = { ...fix(19_000, 0, 4_000) };
    const { outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [a, b, c]);
    expect(outcomes[2]?.accepted).toBe(true);
    expect(outcomes[2]?.openedSegment?.reason).toBe('AFTER_GAP');
    expect(outcomes[2]?.distanceAddedM).toBe(0);
  });
});

describe('CLOCK_ERROR: clock regime change', () => {
  it('a lasting offset jump starts a new segment without bridging, and recording continues', () => {
    const before = seconds(0, 10, (t) => fix(t));
    // From t=11 s the device clock is changed: fix stamps shift by -60 s for good.
    const after = seconds(11, 40, (t) => fix(t, -60_000));
    const { state, outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [
      ...before,
      ...after,
    ]);
    const resetIndex = outcomes.findIndex((o) => o.openedSegment?.reason === 'AFTER_CLOCK_RESET');
    expect(resetIndex).toBeGreaterThan(10);
    expect(outcomes[resetIndex]?.distanceAddedM).toBe(0);
    expect(state.lastSegmentId).toBe(2);
    expect(outcomes.slice(resetIndex).every((o) => o.accepted)).toBe(true);
    expect(state.clockResetCount).toBe(1);
  });
});

describe('CLOCK_ERROR: slow offset drift', () => {
  it('a gradually changing delivery delay (0 → 12 s over 2 min) never splits the track', () => {
    const drifting = seconds(0, 120, (t) => fix(t, 0, t / 10)); // +100 ms delay per second
    const { state, outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), drifting);
    expect(outcomes.filter((o) => o.openedSegment?.reason === 'AFTER_CLOCK_RESET')).toEqual([]);
    expect(state.lastSegmentId).toBe(1);
    expect(state.clockResetCount).toBe(0);
  });
});

describe('CLOCK_ERROR: calibration at start', () => {
  it('a cached first fix is never used as the start point', () => {
    const cached = { ...fix(0), sourceTimestamp: T0 - 120_000 }; // 2 min old, delivered at start
    const fresh = seconds(1, 6, (t) => fix(t));
    const { state, outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [
      cached,
      ...fresh,
    ]);
    expect(outcomes[0]?.accepted).toBe(false);
    expect(state.firstAccepted?.sourceTimestamp).toBeGreaterThanOrEqual(T0);
    expect(state.lastSegmentId).toBe(1);
  });

  it('the first fix of a trip only calibrates the clock (UNTRUSTED), the second is accepted', () => {
    const { outcomes } = feed(createTrackProcessor(cfg, { startedAt: T0 }), [fix(0), fix(1_000)]);
    expect(outcomes[0]?.rejectCode).toBe('UNTRUSTED');
    expect(outcomes[1]?.openedSegment?.reason).toBe('START');
  });
});

describe('CLOCK_ERROR: boundary staleness uses the estimated offset', () => {
  it('a fix captured 4 s before the page became visible is STALE even with a skewed clock', () => {
    const skew = -45_000;
    let { state } = feed(
      createTrackProcessor(cfg, { startedAt: T0 }),
      seconds(0, 5, (t) => fix(t, skew)),
    );
    state = applyBoundary(state, { kind: 'PAGE_HIDDEN', at: T0 + 6_000 }, cfg);
    state = applyBoundary(state, { kind: 'PAGE_VISIBLE', at: T0 + 30_000 }, cfg);
    const capturedWhileHidden = fix(26_000, skew, 4_300); // delivered at 30.5 s
    const fresh = fix(31_000, skew);
    const r1 = processSample(state, capturedWhileHidden, cfg);
    expect(r1.outcome.rejectCode).toBe('STALE');
    const r2 = processSample(r1.state, fresh, cfg);
    expect(r2.outcome.accepted).toBe(true);
    expect(r2.outcome.openedSegment?.reason).toBe('AFTER_HIDDEN');
  });
});
