// @vitest-environment node
/**
 * Route grouping (RT-401) and trip comparison (RT-402, RT-403).
 * The point of these tests is the refusals: same endpoints ≠ same road, mixed modes are not
 * comparable, and a distribution over two trips is not a distribution.
 */
import { describe, expect, it } from 'vitest';
import type { TripMetrics } from '../analytics/analyzeTrip';
import { destinationPoint } from '../geo/haversine';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import type { TransportMode, Trip } from '../models/types';
import { createTrip } from '../trip/tripFactory';
import { compareTrips, MIN_TRIPS_FOR_DISTRIBUTION, type ComparedTrip } from './compare';
import { groupTrips, routedTripOf, sameRoute } from './grouping';

const A = { lat: 20.3, lng: 105.75 };
const B = destinationPoint(A, 90, 5_000);

function trip(options: {
  id: string;
  start?: { lat: number; lng: number } | null;
  end?: { lat: number; lng: number } | null;
  mode?: TransportMode;
  startedAt?: number;
}): Trip {
  const { id, start = A, end = B, mode = 'MOTORBIKE', startedAt = 1_000 } = options;
  return {
    ...createTrip({ id, name: id, transportMode: mode, startedAt }),
    status: 'COMPLETED',
    endedAt: startedAt + 60_000,
    startLat: start?.lat ?? null,
    startLng: start?.lng ?? null,
    endLat: end?.lat ?? null,
    endLng: end?.lng ?? null,
  };
}

describe('route grouping (RT-401)', () => {
  it('groups trips with both endpoints within the radius and the same mode', () => {
    const groups = groupTrips(
      [
        trip({ id: 'a', startedAt: 3_000 }),
        trip({ id: 'b', start: destinationPoint(A, 0, 100), startedAt: 2_000 }),
      ],
      cfg,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.trips.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('keeps a trip apart when an endpoint is beyond the radius', () => {
    const far = destinationPoint(A, 0, cfg.routeGroupRadiusM + 50);
    expect(groupTrips([trip({ id: 'a' }), trip({ id: 'b', start: far })], cfg)).toHaveLength(2);
  });

  it('never groups the reverse direction with the forward one', () => {
    const forward = trip({ id: 'a', start: A, end: B });
    const reverse = trip({ id: 'b', start: B, end: A });
    expect(groupTrips([forward, reverse], cfg)).toHaveLength(2);
  });

  it('never groups different transport modes', () => {
    expect(
      groupTrips([trip({ id: 'a', mode: 'CAR' }), trip({ id: 'b', mode: 'WALK' })], cfg),
    ).toHaveLength(2);
  });

  it('leaves out a trip whose endpoints were never measured (no fabricated endpoint)', () => {
    expect(routedTripOf(trip({ id: 'x', end: null }))).toBeNull();
    expect(groupTrips([trip({ id: 'x', end: null })], cfg)).toHaveLength(0);
  });

  it('leaves out trips that never finished', () => {
    const unfinished = { ...trip({ id: 'live' }), status: 'RECORDING' as const };
    expect(groupTrips([unfinished], cfg)).toHaveLength(0);
  });

  it('sameRoute is symmetric', () => {
    const a = routedTripOf(trip({ id: 'a' }));
    const b = routedTripOf(trip({ id: 'b', start: destinationPoint(A, 180, 120) }));
    if (a === null || b === null) throw new Error('fixture');
    expect(sameRoute(a, b, cfg)).toBe(sameRoute(b, a, cfg));
  });
});

function metrics(over: Partial<TripMetrics>): TripMetrics {
  return {
    distanceMeasuredM: 5_000,
    elapsedMs: 600_000,
    pausedMs: 0,
    movingMs: 500_000,
    stoppedMs: 0,
    unknownMs: 100_000,
    avgElapsedKmh: 30,
    avgMovingKmh: 36,
    maxSpeedKmh: 45,
    minSpeedKmh: 0,
    p95SpeedKmh: 44,
    coveragePct: 95,
    qualityLabel: 'GOOD',
    isIncomplete: false,
    rawCount: 100,
    acceptedCount: 95,
    segmentCount: 1,
    largeGapCount: 0,
    medianAccuracyM: 8,
    start: A,
    end: B,
    edges: [],
    unmeasured: [],
    paused: [],
    segments: [],
    ...over,
  };
}

const compared = (
  id: string,
  over: Partial<TripMetrics> = {},
  mode?: TransportMode,
): ComparedTrip => ({ trip: trip({ id, mode }), metrics: metrics(over) });

describe('trip comparison (RT-402)', () => {
  it('orders by elapsed time and measures every delta against the fastest', () => {
    const c = compareTrips(
      [
        compared('slow', { elapsedMs: 900_000, distanceMeasuredM: 5_200 }),
        compared('fast', { elapsedMs: 600_000, distanceMeasuredM: 5_000 }),
      ],
      cfg.quality.goodCoveragePct,
    );
    expect(c.rows.map((r) => r.tripId)).toEqual(['fast', 'slow']);
    expect(c.fastestTripId).toBe('fast');
    expect(c.rows[0]?.elapsedDeltaMs).toBe(0);
    expect(c.rows[1]?.elapsedDeltaMs).toBe(300_000);
    expect(c.rows[1]?.distanceDeltaM).toBe(200);
  });

  it('flags low coverage: a delta against it compares measurements, not routes', () => {
    const c = compareTrips(
      [compared('good'), compared('patchy', { coveragePct: 40, qualityLabel: 'LOW' })],
      cfg.quality.goodCoveragePct,
    );
    expect(c.lowCoverageCount).toBe(1);
    expect(c.rows.find((r) => r.tripId === 'patchy')?.lowCoverage).toBe(true);
  });

  it('treats unknown coverage as low, never as fine', () => {
    const c = compareTrips([compared('x', { coveragePct: null })], cfg.quality.goodCoveragePct);
    expect(c.rows[0]?.lowCoverage).toBe(true);
  });

  it('reports a mixed-mode selection instead of comparing a car with a walk', () => {
    const c = compareTrips(
      [compared('a', {}, 'CAR'), compared('b', {}, 'WALK')],
      cfg.quality.goodCoveragePct,
    );
    expect(c.mixedModes).toBe(true);
  });
});

describe('distribution (RT-403)', () => {
  it(`stays null below ${String(MIN_TRIPS_FOR_DISTRIBUTION)} trips`, () => {
    const c = compareTrips(
      [compared('a', { elapsedMs: 600_000 }), compared('b', { elapsedMs: 900_000 })],
      cfg.quality.goodCoveragePct,
    );
    expect(c.medianElapsedMs).toBeNull();
    expect(c.p90ElapsedMs).toBeNull();
  });

  it('reports median and P90 from real trips once there are enough', () => {
    const c = compareTrips(
      [
        compared('a', { elapsedMs: 600_000 }),
        compared('b', { elapsedMs: 900_000 }),
        compared('c', { elapsedMs: 1_200_000 }),
      ],
      cfg.quality.goodCoveragePct,
    );
    expect(c.medianElapsedMs).toBe(900_000);
    expect(c.p90ElapsedMs).toBe(1_200_000);
  });

  it('an empty selection compares nothing', () => {
    const c = compareTrips([], cfg.quality.goodCoveragePct);
    expect(c.rows).toHaveLength(0);
    expect(c.fastestTripId).toBeNull();
  });
});
