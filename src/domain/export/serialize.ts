/**
 * Export a trip's data (RT-404). Pure: persisted rows in, text out — no DOM, no IndexedDB.
 *
 * Every format keeps RouteTrack's central rule: measured GPS segments are never joined across a
 * gap, a pause or a hidden page. GPX gets one `<trkseg>` per measured segment, CSV carries the
 * segment id and the reject code of every raw sample, and JSON is a full-fidelity backup.
 */
import { replayTrack } from '../analytics/replay';
import type { GpsConfig } from '../models/gpsConfig';
import type { GpsPoint, Trip, TripEvent } from '../models/types';

export interface TripBundle {
  readonly trip: Trip;
  readonly points: readonly GpsPoint[];
  readonly events: readonly TripEvent[];
}

/** Bumped only on a breaking change to the backup shape; the importer refuses what it cannot read. */
export const BACKUP_SCHEMA_VERSION = 1;

export interface Backup {
  readonly app: 'routetrack';
  readonly schemaVersion: number;
  readonly exportedAt: number;
  readonly trips: readonly TripBundle[];
}

export function toBackupJson(trips: readonly TripBundle[], exportedAt: number): string {
  const backup: Backup = {
    app: 'routetrack',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    trips,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * GPX 1.1. Only accepted fixes are written, one `<trkseg>` per measured segment — a reader must
 * not be able to draw a straight line over a stretch RouteTrack never measured.
 */
export function toGpx(bundle: TripBundle, config: GpsConfig): string {
  const { trip } = bundle;
  const { fixes } = replayTrack({ trip, points: bundle.points, events: bundle.events, config });

  const segments: string[] = [];
  let current: string[] = [];
  let segmentId: number | null = null;
  for (const fix of fixes) {
    if (fix.segmentId !== segmentId) {
      if (current.length > 0) segments.push(current.join(''));
      current = [];
      segmentId = fix.segmentId;
    }
    current.push(trkpt(fix));
  }
  if (current.length > 0) segments.push(current.join(''));

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="RouteTrack" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata><name>${xml(trip.name)}</name><time>${iso(trip.startedAt)}</time></metadata>\n` +
    `  <trk><name>${xml(trip.name)}</name><type>${trip.transportMode}</type>\n` +
    segments.map((seg) => `    <trkseg>${seg}</trkseg>\n`).join('') +
    '  </trk>\n</gpx>\n'
  );
}

function trkpt(fix: {
  lat: number;
  lng: number;
  sourceTimestamp: number;
  accuracyM: number | null;
  speedMps: number | null;
}): string {
  const extras =
    (fix.speedMps === null ? '' : `<speed>${String(fix.speedMps)}</speed>`) +
    (fix.accuracyM === null
      ? ''
      : `<extensions><accuracy>${String(fix.accuracyM)}</accuracy></extensions>`);
  return (
    `<trkpt lat="${String(fix.lat)}" lon="${String(fix.lng)}">` +
    `<time>${iso(fix.sourceTimestamp)}</time>${extras}</trkpt>`
  );
}

const CSV_COLUMNS = [
  'sourceSeq',
  'sourceTimestampIso',
  'recordedAtIso',
  'latitude',
  'longitude',
  'accuracyM',
  'speedMps',
  'accepted',
  'rejectCode',
  'segmentId',
] as const;

/** Every RAW sample, accepted or not — the reject code is the point of exporting raw data. */
export function toCsv(bundle: TripBundle): string {
  const rows = bundle.points.map((p) =>
    [
      p.sourceSeq,
      iso(p.sourceTimestamp),
      iso(p.recordedAt),
      p.latitude,
      p.longitude,
      p.accuracyM,
      p.speedMps,
      p.accepted,
      p.rejectCode,
      p.segmentId,
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Safe, readable file name: `<trip name>-<date>.<ext>`, ASCII-folded. */
export function exportFileName(trip: Trip, ext: string): string {
  const date = new Date(trip.startedAt).toISOString().slice(0, 10);
  const base = trip.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Đ/đ carry no combining mark, so NFD leaves them and the ASCII filter would delete them.
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base === '' ? 'routetrack' : base}-${date}.${ext}`;
}
