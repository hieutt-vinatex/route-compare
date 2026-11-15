// @vitest-environment node
/**
 * Imported tracks (RT-404). An imported GPX must land in exactly the same shapes RouteTrack
 * records itself, so the analytics engine — not a second code path — produces its numbers.
 */
import { describe, expect, it } from 'vitest';
import { analyzeTrip } from '../analytics/analyzeTrip';
import { destinationPoint } from '../geo/haversine';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import { ORIGIN } from '@/tests/fixtures/gpsFixtures';
import {
  buildImportedTrip,
  GAP_INTERVAL_FACTOR,
  importConfig,
  type ImportedFix,
} from './importedTrip';

const T0 = Date.parse('2026-11-12T10:00:00Z');

function ids(): () => string {
  let n = 0;
  return () => `i${++n}`;
}

/** A logger track: `count` fixes, `intervalMs` apart, moving at `speedMps` due east. */
function track(options: {
  count: number;
  intervalMs?: number;
  speedMps?: number;
  accuracyM?: number | null;
  startT?: number;
  segmentIndex?: number;
  from?: { lat: number; lng: number };
}): ImportedFix[] {
  const {
    count,
    intervalMs = 1000,
    speedMps = 5,
    accuracyM = 8,
    startT = T0,
    segmentIndex = 0,
    from = ORIGIN,
  } = options;
  return Array.from({ length: count }, (_, i): ImportedFix => {
    const at = destinationPoint(from, 90, (speedMps * i * intervalMs) / 1000);
    return {
      lat: at.lat,
      lng: at.lng,
      timestamp: startT + i * intervalMs,
      accuracyM,
      speedMps: null,
      segmentIndex,
    };
  });
}

function build(fixes: readonly ImportedFix[]) {
  return buildImportedTrip({
    fixes,
    name: 'Chuyến nhập',
    transportMode: 'MOTORBIKE',
    source: 'GPX',
    ids: ids(),
    now: T0 + 9_000_000,
    config: cfg,
  });
}

describe('importConfig', () => {
  it("takes the gap threshold from the file's own sampling rate, not RouteTrack's 20 s", () => {
    const every30s = track({ count: 20, intervalMs: 30_000 });
    expect(importConfig(every30s, cfg).maxGapMs).toBe(GAP_INTERVAL_FACTOR * 30_000);
  });

  it('never drops below RouteTrack’s own threshold for a fast logger', () => {
    expect(importConfig(track({ count: 20, intervalMs: 1000 }), cfg).maxGapMs).toBe(cfg.maxGapMs);
  });

  it('accepts a file that states no accuracy, but still requires it when the file has it', () => {
    expect(importConfig(track({ count: 5, accuracyM: null }), cfg).requireAccuracy).toBe(false);
    expect(importConfig(track({ count: 5, accuracyM: 8 }), cfg).requireAccuracy).toBe(true);
  });

  it('spends no fix on clock calibration: the file carries one clock', () => {
    expect(importConfig(track({ count: 5 }), cfg).clock.minSamples).toBe(1);
  });
});

describe('buildImportedTrip', () => {
  it('builds a COMPLETED trip spanning the file, marked as imported', () => {
    const { trip, points, events } = build(track({ count: 10, intervalMs: 1000 }));
    expect(trip.status).toBe('COMPLETED');
    expect(trip.importedFrom).toBe('GPX');
    expect(trip.startedAt).toBe(T0);
    expect(trip.endedAt).toBe(T0 + 9000);
    expect(trip.elapsedMs).toBe(9000);
    expect(points).toHaveLength(10);
    expect(events.map((e) => e.type)).toEqual(['START', 'END']);
  });

  it('keeps one strictly increasing sequence over events and points (replay order, D2)', () => {
    const { points, events } = build([
      ...track({ count: 3 }),
      ...track({ count: 3, startT: T0 + 60_000, segmentIndex: 1 }),
    ]);
    const seqs = [...points.map((p) => p.sourceSeq), ...events.map((e) => e.seq)].sort(
      (a, b) => a - b,
    );
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('refuses an empty track rather than creating a trip with no data', () => {
    expect(() => build([])).toThrow(RangeError);
  });
});

describe('imported track through the analytics engine', () => {
  const analyze = (fixes: readonly ImportedFix[]) => {
    const { trip, points, events } = build(fixes);
    return analyzeTrip({
      trip,
      points,
      events,
      endedAt: trip.endedAt ?? trip.startedAt,
      config: importConfig(fixes, cfg),
    });
  };

  it('a 30 s-interval logger track is measured, not written off as one long gap', () => {
    // The whole point: RouteTrack's live 20 s rule would make every step a gap and every metre
    // unmeasurable, reporting 0 m for a perfectly good background recording.
    const fixes = track({ count: 41, intervalMs: 30_000, speedMps: 10 });
    const m = analyze(fixes);

    expect(m.segmentCount).toBe(1);
    expect(m.distanceMeasuredM).toBeGreaterThan(0.9 * 10 * 40 * 30);
    expect(m.movingMs).toBeGreaterThan(0.8 * m.elapsedMs);
    expect(m.avgMovingKmh ?? 0).toBeCloseTo(36, 0);

    // …and the strict live config really would have destroyed it.
    const strict = analyzeTrip({
      ...(() => {
        const built = build(fixes);
        return { trip: built.trip, points: built.points, events: built.events };
      })(),
      endedAt: T0 + 40 * 30_000,
      config: cfg,
    });
    expect(strict.distanceMeasuredM).toBe(0);
  });

  it('a logger restart (<trkseg>) splits segments and bridges no distance', () => {
    const first = track({ count: 10, intervalMs: 1000, speedMps: 10 });
    const far = destinationPoint(ORIGIN, 90, 50_000);
    const second = track({
      count: 10,
      intervalMs: 1000,
      speedMps: 10,
      startT: T0 + 20_000,
      segmentIndex: 1,
      from: far,
    });
    const m = analyze([...first, ...second]);

    expect(m.segmentCount).toBe(2);
    // The 50 km jump between the two segments must not be in the distance.
    expect(m.distanceMeasuredM).toBeLessThan(1000);
  });

  it('a file without any accuracy is still measured (requireAccuracy off)', () => {
    const m = analyze(track({ count: 30, intervalMs: 5000, speedMps: 8, accuracyM: null }));
    expect(m.acceptedCount).toBeGreaterThan(25);
    expect(m.distanceMeasuredM).toBeGreaterThan(0);
  });
});
