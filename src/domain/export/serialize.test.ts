// @vitest-environment node
/**
 * Export + backup restore (RT-404, RT-405). The rule an export must never break: measured GPS
 * segments stay apart, so no reader can draw a line over a stretch RouteTrack never measured.
 */
import { describe, expect, it } from 'vitest';
import { straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples, type Step } from '@/tests/fixtures/persistedTrip';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
import { destinationPoint, haversineM } from '../geo/haversine';
import { replayTrack } from '../analytics/replay';
import { BackupParseError, parseBackup } from './parseBackup';
import {
  BACKUP_SCHEMA_VERSION,
  exportFileName,
  toBackupJson,
  toCsv,
  toGpx,
  type TripBundle,
} from './serialize';

function bundle(steps: readonly Step[]): TripBundle {
  const { trip, points, events } = persistedTrip(steps);
  return { trip, points, events };
}

/** Two stretches of GPS separated by a 90 s silence: two measured segments. */
const gapped = bundle([
  ...samples(straightLine({ count: 10, startT: 0, speedMps: 5 })),
  ...samples(
    straightLine({ count: 10, startT: 100_000, speedMps: 5, from: { lat: 20.5, lng: 105.9 } }),
  ),
]);

describe('toGpx', () => {
  it('keeps the sampling rules of imported GPX files when exporting them again', () => {
    const slow = bundle(samples(straightLine({ count: 21, intervalMs: 30_000, speedMps: 5 })));
    const imported = {
      ...slow,
      trip: { ...slow.trip, importedFrom: 'GPX' as const },
      points: slow.points.map((p) => ({ ...p, accuracyM: null })),
    };
    const gpx = toGpx(imported, cfg);
    expect(gpx.match(/<trkseg>/g) ?? []).toHaveLength(1);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBeGreaterThan(10);
  });
  it('writes one <trkseg> per measured segment and never bridges the gap', () => {
    const gpx = toGpx(gapped, cfg);
    expect(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((gpx.match(/<trkseg>/g) ?? []).length).toBe(2);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBeGreaterThan(10);
    expect(gpx).toContain('<time>');
  });

  it('escapes the trip name instead of producing broken XML', () => {
    const named = bundle(samples(straightLine({ count: 5 })));
    const gpx = toGpx({ ...named, trip: { ...named.trip, name: 'A & B <test>' } }, cfg);
    expect(gpx).toContain('A &amp; B &lt;test&gt;');
    expect(gpx).not.toContain('<test>');
  });
});

describe('toCsv', () => {
  it('exports every RAW sample with its reject code, not only the accepted ones', () => {
    const csv = toCsv(gapped);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toContain('rejectCode');
    expect(lines).toHaveLength(gapped.points.length + 1);
  });

  it('quotes a cell that contains a comma or a quote', () => {
    const one = bundle(samples(straightLine({ count: 3 })));
    const csv = toCsv({
      ...one,
      points: one.points.map((p) => ({ ...p, rejectCode: null, id: 'a,"b"' })),
    });
    expect(csv).not.toContain('a,"b"'); // raw form would break the column count
  });
});

describe('private endpoint export (FR-22)', () => {
  const route = bundle(samples(straightLine({ count: 81, speedMps: 5 })));

  it('removes every CSV sample inside either endpoint circle, including rejected samples', () => {
    const csv = toCsv(route, 50);
    const rows = csv.trimEnd().split('\n').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(route.points.length);
    const start = route.points[0]!;
    const end = route.points.at(-1)!;
    for (const row of rows) {
      const cells = row.split(',');
      const p = { lat: Number(cells[3]), lng: Number(cells[4]) };
      expect(haversineM(p, { lat: start.latitude, lng: start.longitude })).toBeGreaterThan(50);
      expect(haversineM(p, { lat: end.latitude, lng: end.longitude })).toBeGreaterThan(50);
    }
    expect(route.points).toHaveLength(81);
  });

  it('removes GPX endpoints after replay while preserving separate measured segments', () => {
    const gpx = toGpx(route, cfg, 50);
    const fixes = replayTrack({ ...route, config: cfg }).fixes;
    const start = fixes[0]!;
    const end = fixes.at(-1)!;
    const coordinates = [...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)];
    expect(coordinates.length).toBeGreaterThan(0);
    for (const match of coordinates) {
      const p = { lat: Number(match[1]), lng: Number(match[2]) };
      expect(haversineM(p, start)).toBeGreaterThan(50);
      expect(haversineM(p, end)).toBeGreaterThan(50);
    }
    expect(toGpx(gapped, cfg, 5).match(/<trkseg>/g) ?? []).toHaveLength(2);
  });

  it('starts a new CSV segment after revisiting a hidden endpoint area', () => {
    const start = { lat: route.points[0]!.latitude, lng: route.points[0]!.longitude };
    const distances = [0, 100, 150, 0, 200, 250, 400];
    const points = distances.map((distance, i) => {
      const p = destinationPoint(start, 90, distance);
      return {
        ...route.points[i]!,
        latitude: p.lat,
        longitude: p.lng,
        accepted: true,
        segmentId: 1,
      };
    });
    const rows = toCsv({ ...route, points }, 30)
      .trimEnd()
      .split('\n')
      .slice(1);
    expect(rows).toHaveLength(4);
    const segments = rows.map((row) => row.split(',')[10]);
    expect(segments[0]).toBe(segments[1]);
    expect(segments[2]).toBe(segments[3]);
    expect(segments[0]).not.toBe(segments[2]);
  });

  it('gives imported raw samples explicit export runs across original and privacy boundaries', () => {
    const origin = { lat: 20.3, lng: 105.75 };
    const distances = [0, 100, 150, 0, 200, 250, 300, 350, 400];
    const points = distances.map((distance, i) => {
      const p = destinationPoint(origin, 90, distance);
      return {
        ...route.points[i]!,
        sourceSeq: i * 2 + 1,
        latitude: p.lat,
        longitude: p.lng,
        accepted: false,
        segmentId: null,
      };
    });
    const imported = {
      ...route,
      trip: { ...route.trip, importedFrom: 'GPX' as const },
      points,
      events: [
        {
          id: 'recovery',
          tripId: route.trip.id,
          seq: 12,
          timestamp: points[6]!.recordedAt,
          type: 'RECOVERY' as const,
          metadata: null,
        },
      ],
    };
    const rows = toCsv(imported, 30).trimEnd().split('\n');
    expect(rows[0]).toContain('exportRunId');
    expect(rows.slice(1).map((row) => row.split(',')[10])).toEqual(['1', '1', '2', '2', '3', '3']);
  });

  it('splits GPX when a removed raw sample was rejected by the GPS filter', () => {
    const first = route.points[0]!;
    const points = route.points.map((p, i) =>
      i === 40 ? { ...p, latitude: first.latitude, longitude: first.longitude } : p,
    );
    const withRejectedReturn = { ...route, points };
    expect(toGpx(withRejectedReturn, cfg).match(/<trkseg>/g) ?? []).toHaveLength(1);
    expect(toGpx(withRejectedReturn, cfg, 30).match(/<trkseg>/g) ?? []).toHaveLength(2);
  });

  it('rejects invalid radii, reports fully hidden routes, and keeps zero-radius exports compatible', () => {
    expect(() => toGpx(route, cfg, -1)).toThrow(RangeError);
    expect(() => toCsv(route, Number.NaN)).toThrow(RangeError);
    expect(() => toGpx(route, cfg, 1000)).toThrow(/không còn điểm/i);
    expect(() => toCsv(route, 1000)).toThrow(/không còn điểm/i);
    expect(toCsv(route, 0)).toBe(toCsv(route));
    expect(toGpx(route, cfg, 0)).toBe(toGpx(route, cfg));
    expect(parseBackup(toBackupJson([route], T0))[0]?.points).toEqual(route.points);
  });
});

describe('exportFileName', () => {
  it('folds Vietnamese and punctuation into a safe name', () => {
    const { trip } = persistedTrip(samples(straightLine({ count: 2 })));
    const name = exportFileName({ ...trip, name: 'Đi làm / sáng' }, 'gpx');
    expect(name).toMatch(/^Di-lam-sang-\d{4}-\d{2}-\d{2}\.gpx$/);
  });

  it('falls back when the name folds away to nothing', () => {
    const { trip } = persistedTrip(samples(straightLine({ count: 2 })));
    expect(exportFileName({ ...trip, name: '—' }, 'json')).toMatch(/^routetrack-/);
  });
});

describe('backup round trip', () => {
  it('restores exactly what was exported', () => {
    const restored = parseBackup(toBackupJson([gapped], T0));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.trip).toEqual(gapped.trip);
    expect(restored[0]?.points).toEqual(gapped.points);
    expect(restored[0]?.events).toEqual(gapped.events);
  });

  it('re-points every row at the trip it is nested under', () => {
    const json = JSON.parse(toBackupJson([gapped], T0)) as {
      trips: { points: { tripId: string }[] }[];
    };
    const first = json.trips[0];
    if (first !== undefined) for (const p of first.points) p.tripId = 'somebody-elses-trip';
    const restored = parseBackup(JSON.stringify(json));
    expect(restored[0]?.points.every((p) => p.tripId === gapped.trip.id)).toBe(true);
  });

  it.each([
    ['không phải JSON', 'hello'],
    ['không phải RouteTrack', '{"app":"other","schemaVersion":1,"trips":[]}'],
    [
      'định dạng mới hơn',
      `{"app":"routetrack","schemaVersion":${String(BACKUP_SCHEMA_VERSION + 1)},"trips":[]}`,
    ],
    ['thiếu danh sách', '{"app":"routetrack","schemaVersion":1}'],
    [
      'toạ độ ngoài phạm vi',
      JSON.stringify({
        app: 'routetrack',
        schemaVersion: 1,
        exportedAt: 0,
        trips: [
          {
            trip: { ...gapped.trip },
            points: [{ ...gapped.points[0], latitude: 999 }],
            events: [],
          },
        ],
      }),
    ],
  ])('refuses %s with a reason, importing nothing', (_case, text) => {
    expect(() => parseBackup(text)).toThrow(BackupParseError);
  });

  it('ignores an unknown extra field rather than failing a valid backup', () => {
    const json = JSON.parse(toBackupJson([gapped], T0)) as Record<string, unknown>;
    json['somethingNew'] = { a: 1 };
    expect(parseBackup(JSON.stringify(json))).toHaveLength(1);
  });
});
