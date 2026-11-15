// @vitest-environment node
/**
 * Export + backup restore (RT-404, RT-405). The rule an export must never break: measured GPS
 * segments stay apart, so no reader can draw a line over a stretch RouteTrack never measured.
 */
import { describe, expect, it } from 'vitest';
import { straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples, type Step } from '@/tests/fixtures/persistedTrip';
import { DEFAULT_GPS_CONFIG as cfg } from '../models/gpsConfig';
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
