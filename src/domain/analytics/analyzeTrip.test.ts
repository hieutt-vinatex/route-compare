// @vitest-environment node
/**
 * Analytics engine (RT-204, RT-207): docs/05 §5–§8 — GPS-003, GPS-009, GPS-010, GPS-011.
 * The engine replays persisted raw points + events, so it is the source of truth for summaries.
 */
import { describe, expect, it } from 'vitest';
import { ORIGIN, stationaryJitter, straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip as persisted, samples, type Step } from '@/tests/fixtures/persistedTrip';
import { createControllerHarness } from '@/tests/harness';
import { destinationPoint } from '../geo/haversine';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import type { TransportMode } from '../models/types';
import { analyzeTrip } from './analyzeTrip';

function analyze(steps: readonly Step[], endT: number, mode?: TransportMode) {
  const { trip, points, events } = persisted(steps, mode);
  return analyzeTrip({ trip, points, events, endedAt: T0 + endT, config: cfg });
}

const sumOfParts = (m: {
  pausedMs: number;
  movingMs: number;
  stoppedMs: number;
  unknownMs: number;
}) => m.pausedMs + m.movingMs + m.stoppedMs + m.unknownMs;

describe('GPS-010 time partition', () => {
  it('elapsed = moving + stopped + paused + unknown (± 1 ms) for move, stop, pause and gap', () => {
    const moving1 = straightLine({ count: 60, startT: 1_000, speedMps: 5 });
    const stopAt = destinationPoint(ORIGIN, 90, 5 * 59);
    const stop = stationaryJitter({
      count: 30,
      startT: 61_000,
      center: stopAt,
      radiusM: 3,
      accuracyM: 6,
    });
    const moving2 = straightLine({ count: 25, startT: 216_000, speedMps: 5, from: stopAt });
    const m = analyze(
      [
        ...samples(moving1),
        ...samples(stop),
        { event: 'PAUSE', t: 95_000 },
        { event: 'RESUME', t: 215_000 },
        ...samples(moving2),
      ],
      250_000,
    );
    expect(m.elapsedMs).toBe(250_000);
    expect(m.pausedMs).toBe(120_000);
    expect(Math.abs(sumOfParts(m) - m.elapsedMs)).toBeLessThanOrEqual(1);
    expect(m.stoppedMs).toBeGreaterThan(20_000);
    expect(m.movingMs).toBeGreaterThan(70_000);
    expect(m.unknownMs).toBeGreaterThan(0);
  });

  it('GPS-003: a 90 s GPS gap adds about 90 s of UNKNOWN and no distance', () => {
    const a = straightLine({ count: 10, startT: 0, speedMps: 5 });
    const b = straightLine({
      count: 10,
      startT: 99_000,
      speedMps: 5,
      from: destinationPoint(ORIGIN, 0, 2_000),
    });
    const m = analyze(samples([...a, ...b]), 109_000);
    expect(m.unknownMs).toBeGreaterThanOrEqual(89_000);
    expect(m.unknownMs).toBeLessThanOrEqual(92_000);
    expect(m.distanceMeasuredM).toBeLessThan(100);
    expect(m.largeGapCount).toBe(1);
  });
});

describe('GPS-009 / stop confirmation (§6)', () => {
  it('with no confirmed stop, min speed is the slowest moving speed — never 0', () => {
    const m = analyze(samples(straightLine({ count: 60, speedMps: 5 })), 60_000);
    expect(m.stoppedMs).toBe(0);
    expect(m.minSpeedKmh).not.toBe(0);
    expect(m.minSpeedKmh).toBeCloseTo(18, 0);
  });

  it('a 30 s stop is STOPPED and min speed is 0', () => {
    const move = straightLine({ count: 20, speedMps: 5 });
    const at = destinationPoint(ORIGIN, 90, 95);
    const stop = stationaryJitter({
      count: 31,
      startT: 20_000,
      center: at,
      radiusM: 3,
      accuracyM: 6,
    });
    const m = analyze(samples([...move, ...stop]), 51_000);
    expect(m.stoppedMs).toBeGreaterThanOrEqual(25_000);
    expect(m.minSpeedKmh).toBe(0);
  });

  /** 20 s at 5 m/s, 10 s standing still, 20 s at 5 m/s again. */
  function shortStop(reportSpeed: boolean): Step[] {
    const move = straightLine({ count: 20, speedMps: 5, reportSpeed });
    const at = destinationPoint(ORIGIN, 90, 95);
    const still = stationaryJitter({
      count: 10,
      startT: 20_000,
      center: at,
      radiusM: 3,
      accuracyM: 6,
    })
      // A Doppler receiver reports ~0 m/s while standing still.
      .map((s) => (reportSpeed ? { ...s, speedMps: 0 } : s));
    const again = straightLine({ count: 20, startT: 30_000, speedMps: 5, from: at, reportSpeed });
    return samples([...move, ...still, ...again]);
  }

  it('a 10 s stop (below the 15 s dwell) is never STOPPED and, with coords.speed, stays UNKNOWN', () => {
    const m = analyze(shortStop(true), 50_000);
    expect(m.stoppedMs).toBe(0);
    expect(m.unknownMs).toBeGreaterThanOrEqual(5_000);
  });

  it('without coords.speed a 10 s stop is still never STOPPED (it may read as slow movement)', () => {
    const m = analyze(shortStop(false), 50_000);
    expect(m.stoppedMs).toBe(0);
  });
});

describe('SPEED_NULL classification (GPS-007, review C1): coords.speed = null', () => {
  it.each([
    [1.0, 5],
    [1.0, 10],
    [1.4, 5],
    [1.4, 10],
    [1.0, 15],
  ])('a %f m/s walk at accuracy %d m is MOVING, never a stop', (speed, accuracyM) => {
    const walk = straightLine({ count: 301, speedMps: speed, accuracyM });
    const m = analyze(samples(walk), 300_300, 'WALK');
    expect(m.stoppedMs).toBe(0);
    expect(m.minSpeedKmh).not.toBe(0);
    expect(m.movingMs).toBeGreaterThan(0.8 * 300_000);
    expect(m.coveragePct).toBeGreaterThan(80);
  });

  it('a bicycle at 3 m/s with 15 m accuracy is MOVING', () => {
    const ride = straightLine({ count: 301, speedMps: 3, accuracyM: 15 });
    const m = analyze(samples(ride), 300_300, 'BICYCLE');
    expect(m.movingMs).toBeGreaterThan(0.8 * 300_000);
    expect(m.avgMovingKmh).toBeCloseTo(10.8, 0);
  });

  it('a car with one fix every 8 s (inside maxGap) is MOVING, not UNKNOWN', () => {
    const car = straightLine({ count: 40, speedMps: 10, intervalMs: 8_000, accuracyM: 5 });
    const m = analyze(samples(car), 312_300, 'CAR');
    expect(m.movingMs).toBeGreaterThan(0.8 * 312_000);
    expect(m.maxSpeedKmh).toBeCloseTo(36, 0);
  });

  it('standing still for a minute at 10 m accuracy is a confirmed stop', () => {
    const still = stationaryJitter({ count: 61, radiusM: 5, accuracyM: 10 });
    const m = analyze(samples(still), 60_300, 'WALK');
    expect(m.stoppedMs).toBeGreaterThan(40_000);
    expect(m.movingMs).toBe(0);
  });
});

describe('speeds (§7)', () => {
  it.each([
    ['the 2nd fix', 2], // index 0 calibrates the clock, 1 opens the segment
    ['the last fix', 59],
  ])(
    'max speed ignores a single provider-speed spike at %s of a segment (review I3)',
    (_where, index) => {
      const line = straightLine({ count: 60, speedMps: 10, reportSpeed: true }).map((s, i) =>
        i === index ? { ...s, speedMps: 60 } : s,
      );
      const m = analyze(samples(line), 60_000, 'CAR');
      expect(m.maxSpeedKmh).toBeCloseTo(36, 0);
    },
  );

  it('max speed ignores a single raw spike', () => {
    const line = straightLine({ count: 30, speedMps: 5 });
    const mid = line[15];
    const spiky = line.map((s) => (s === mid ? { ...s, lng: s.lng + 0.0004 } : s));
    const m = analyze(samples(spiky), 30_000, 'CAR');
    expect(m.maxSpeedKmh).not.toBeNull();
    expect(m.maxSpeedKmh ?? 0).toBeLessThan(25);
  });

  it('average speeds: door-to-door over elapsed, moving over moving time', () => {
    const m = analyze(samples(straightLine({ count: 61, speedMps: 5 })), 120_000);
    // First fix only calibrates the clock; the drift filter drops a < 7 m tail → 290 m.
    expect(m.distanceMeasuredM).toBeGreaterThan(285);
    expect(m.avgElapsedKmh).toBeCloseTo((m.distanceMeasuredM / 120) * 3.6, 6);
    expect(m.avgMovingKmh).toBeCloseTo(18, 0);
  });

  it('reports no speeds (null, “—”) without measured movement', () => {
    const m = analyze(samples([{ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng }]), 10_000);
    expect(m.avgElapsedKmh).toBeNull();
    expect(m.avgMovingKmh).toBeNull();
    expect(m.maxSpeedKmh).toBeNull();
    expect(m.minSpeedKmh).toBeNull();
  });
});

describe('coverage and quality (§8)', () => {
  it('GPS-011: 40 % of active time without GPS → coverage ≈ 60 %, LOW', () => {
    const m = analyze(samples(straightLine({ count: 61, speedMps: 5 })), 100_000);
    expect(m.coveragePct).toBeGreaterThan(57);
    expect(m.coveragePct).toBeLessThan(62);
    expect(m.qualityLabel).toBe('LOW');
    expect(m.isIncomplete).toBe(true);
  });

  it('a clean, fully covered trip is GOOD and complete', () => {
    const m = analyze(samples(straightLine({ count: 121, speedMps: 5 })), 120_300);
    expect(m.coveragePct).toBeGreaterThan(95);
    expect(m.qualityLabel).toBe('GOOD');
    expect(m.isIncomplete).toBe(false);
    expect(m.start).not.toBeNull();
    expect(m.end).not.toBeNull();
  });

  it('any hidden-page window marks the trip incomplete, even a short one (BRD §6 warning)', () => {
    const a = straightLine({ count: 30, speedMps: 5 });
    const b = straightLine({
      count: 30,
      startT: 32_000,
      speedMps: 5,
      from: destinationPoint(ORIGIN, 90, 160),
    });
    const m = analyze(
      [
        ...samples(a),
        { event: 'PAGE_HIDDEN', t: 30_000 },
        { event: 'PAGE_VISIBLE', t: 31_500 },
        ...samples(b),
      ],
      62_000,
    );
    expect(m.largeGapCount).toBe(0);
    expect(m.isIncomplete).toBe(true);
  });

  it('locking the screen during a user pause does not make the trip incomplete (review M1)', () => {
    const a = straightLine({ count: 30, speedMps: 5 });
    const b = straightLine({
      count: 30,
      startT: 400_000,
      speedMps: 5,
      from: destinationPoint(ORIGIN, 90, 145),
    });
    const m = analyze(
      [
        ...samples(a),
        { event: 'PAUSE', t: 30_000 },
        { event: 'PAGE_HIDDEN', t: 40_000 },
        { event: 'PAGE_VISIBLE', t: 390_000 },
        { event: 'RESUME', t: 399_500 },
        ...samples(b),
      ],
      430_000,
    );
    expect(m.pausedMs).toBe(369_500);
    expect(m.isIncomplete).toBe(false);
  });

  it('a user pause alone does not make a trip incomplete', () => {
    const a = straightLine({ count: 30, speedMps: 5 });
    const b = straightLine({
      count: 30,
      startT: 60_000,
      speedMps: 5,
      from: destinationPoint(ORIGIN, 90, 145),
    });
    const m = analyze(
      [...samples(a), { event: 'PAUSE', t: 30_000 }, { event: 'RESUME', t: 59_500 }, ...samples(b)],
      90_000,
    );
    expect(m.pausedMs).toBe(29_500);
    expect(m.isIncomplete).toBe(false);
  });

  it('reports the pause intervals on the app clock (chart bands)', () => {
    const a = straightLine({ count: 30, speedMps: 5 });
    const m = analyze([...samples(a), { event: 'PAUSE', t: 30_000 }], 50_000);
    expect(m.paused).toEqual([{ from: T0 + 30_000, to: T0 + 50_000 }]);
  });

  it('coverage is null when there is no active time', () => {
    const m = analyze([{ event: 'PAUSE', t: 0 }], 0);
    expect(m.coveragePct).toBeNull();
  });

  it('the data minimums for quality and speed statistics come from GpsConfig (M2 minor M11)', () => {
    const { trip, points, events } = persisted(samples(straightLine({ count: 8, speedMps: 5 })));
    const input = { trip, points, events, endedAt: T0 + 7_500 };
    expect(analyzeTrip({ ...input, config: cfg }).qualityLabel).toBe('LOW'); // < 10 fixes
    const lenient = { ...cfg, quality: { ...cfg.quality, minAcceptedFixes: 5 } };
    expect(analyzeTrip({ ...input, config: lenient }).qualityLabel).not.toBe('LOW');
    const long = persisted(samples(straightLine({ count: 40, speedMps: 5 })));
    const longInput = { ...long, endedAt: T0 + 39_500 };
    expect(analyzeTrip({ ...longInput, config: cfg }).maxSpeedKmh).not.toBeNull();
    const strict = { ...cfg, minSpeedStatEdges: 100 };
    expect(analyzeTrip({ ...longInput, config: strict }).maxSpeedKmh).toBeNull();
  });

  it('too little data is LOW whatever the coverage', () => {
    const m = analyze(samples(straightLine({ count: 4, speedMps: 5 })), 3_300);
    expect(m.qualityLabel).toBe('LOW');
  });

  it('END_WITHOUT_FIX: no end point when GPS was lost long before End', () => {
    const m = analyze(samples(straightLine({ count: 10, speedMps: 5 })), 90_000);
    expect(m.end).toBeNull();
    expect(m.isIncomplete).toBe(true);
  });
});

describe('replay = live (ADR-16)', () => {
  it('re-analysing the persisted data reproduces the live distance and segments', async () => {
    const h = createControllerHarness();
    h.clock.set(T0);
    await h.controller.start({ name: 'live', transportMode: 'MOTORBIKE' });
    await h.calibrate();
    await h.emitAll(straightLine({ count: 12, startT: 1_000, speedMps: 5 }));
    h.clock.set(T0 + 13_000);
    h.visibility.setVisible(false);
    await h.emit({ t: 14_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    h.clock.set(T0 + 30_000);
    h.visibility.setVisible(true);
    await h.emitAll(
      straightLine({
        count: 12,
        startT: 30_500,
        speedMps: 5,
        from: destinationPoint(ORIGIN, 0, 500),
      }),
    );
    const live = h.controller.getSnapshot();
    const tripId = live.tripId ?? '';
    const trip = await h.repo.getTrip(tripId);
    if (trip === undefined) throw new Error('trip missing');
    const m = analyzeTrip({
      trip,
      points: await h.repo.listPoints(tripId),
      events: await h.repo.listEvents(tripId),
      endedAt: T0 + 42_000,
      config: cfg,
    });
    expect(m.distanceMeasuredM).toBeCloseTo(live.distanceMeasuredM, 6);
    expect(m.segmentCount).toBe(live.segmentCount);
    expect(m.acceptedCount).toBe(live.acceptedCount);
  });
});

describe('performance (NFR-09, docs/07 §5)', () => {
  it('analyses a 10 000-point trip fast enough for End (median of 3 runs, warm)', () => {
    // Measured on the dev machine: ~100 ms cold, ~40 ms warm. Warm median of 3 keeps the plan's
    // 500 ms bound stable under parallel workers while still catching a 10× regression.
    const big = straightLine({ count: 10_000, speedMps: 8 });
    const { trip, points, events } = persisted(samples(big));
    const runOnce = (): number => {
      const t = performance.now();
      analyzeTrip({ trip, points, events, endedAt: T0 + 10_000_000, config: cfg });
      return performance.now() - t;
    };
    runOnce();
    const runs = [runOnce(), runOnce(), runOnce()].sort((a, b) => a - b);
    expect(runs[1]).toBeLessThan(500);
  });
});
