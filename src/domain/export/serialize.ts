/**
 * Export a trip's data (RT-404). Pure: persisted rows in, text out — no DOM, no IndexedDB.
 *
 * Every format keeps RouteTrack's central rule: measured GPS segments are never joined across a
 * gap, a pause or a hidden page. GPX gets one `<trkseg>` per measured segment, CSV carries the
 * segment id and the reject code of every raw sample, and JSON is a full-fidelity backup.
 */
import { replayTrack } from '../analytics/replay';
import { outsideEndpointAreas } from './privacy';
import { importConfig } from '../import/importedTrip';
import type { GpsConfig } from '../models/gpsConfig';
import { DEFAULT_GPS_CONFIG } from '../models/gpsConfig';
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
export function toGpx(bundle: TripBundle, config: GpsConfig, privacyRadiusM = 0): string {
  const { trip } = bundle;
  const replayConfig =
    trip.importedFrom === 'GPX'
      ? importConfig(
          bundle.points.map((p) => ({ timestamp: p.sourceTimestamp, accuracyM: p.accuracyM })),
          config,
        )
      : config;
  const { fixes } = replayTrack({
    trip,
    points: bundle.points,
    events: bundle.events,
    config: replayConfig,
  });

  const segments: string[] = [];
  let current: string[] = [];
  let segmentId: number | null = null;
  const raw = bundle.points.toSorted((a, b) => a.sourceSeq - b.sourceSeq);
  const rawSamples = raw.map((point) => ({ lat: point.latitude, lng: point.longitude, point }));
  const fixEnds = [fixes[0], fixes.at(-1)].filter((p) => p !== undefined);
  const fixesById = new Map(fixes.map((fix) => [fix.pointId, fix]));
  for (const run of outsideEndpointAreas(rawSamples, privacyRadiusM, fixEnds)) {
    for (const { point } of run) {
      const fix = fixesById.get(point.id);
      if (fix === undefined) continue;
      if (fix.segmentId !== segmentId) {
        if (current.length > 0) segments.push(current.join(''));
        current = [];
        segmentId = fix.segmentId;
      }
      current.push(trkpt(fix));
    }
    if (current.length > 0) segments.push(current.join(''));
    current = [];
    segmentId = null;
  }
  if (privacyRadiusM > 0 && segments.length === 0) {
    throw new RangeError('Không còn điểm GPS để xuất sau khi ẩn đầu/cuối.');
  }

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
export function toCsv(bundle: TripBundle, privacyRadiusM = 0, config = DEFAULT_GPS_CONFIG): string {
  const ordered = bundle.points.toSorted((a, b) => a.sourceSeq - b.sourceSeq);
  const coordinates = ordered.map((point) => ({
    lat: point.latitude,
    lng: point.longitude,
    point,
  }));
  const { trip } = bundle;
  const centers = [
    { lat: trip.startLat, lng: trip.startLng },
    { lat: trip.endLat, lng: trip.endLng },
  ].filter((p): p is { lat: number; lng: number } => p.lat !== null && p.lng !== null);
  const runs = outsideEndpointAreas(coordinates, privacyRadiusM, centers);
  const sampling =
    trip.importedFrom === 'GPX'
      ? importConfig(
          ordered.map((p) => ({ timestamp: p.sourceTimestamp, accuracyM: p.accuracyM })),
          config,
        )
      : config;
  const boundaryTypes = new Set([
    'PAUSE',
    'RESUME',
    'PAGE_HIDDEN',
    'PAGE_VISIBLE',
    'RECOVERY',
    'GPS_GAP_BEGIN',
    'GPS_GAP_END',
  ]);
  const boundaries = bundle.events
    .filter((event) => boundaryTypes.has(event.type))
    .toSorted((a, b) => a.seq - b.seq);
  let boundaryIndex = 0;
  let runId = 0;
  const exportRuns = new Map<string, number>();
  for (const run of runs) {
    let previous: GpsPoint | null = null;
    runId += 1;
    for (const { point } of run) {
      let crossedBoundary = false;
      while ((boundaries[boundaryIndex]?.seq ?? Number.POSITIVE_INFINITY) <= point.sourceSeq) {
        crossedBoundary = true;
        boundaryIndex += 1;
      }
      if (
        previous !== null &&
        (crossedBoundary ||
          previous.segmentId !== point.segmentId ||
          Math.max(
            point.sourceTimestamp - previous.sourceTimestamp,
            point.recordedAt - previous.recordedAt,
          ) > sampling.maxGapMs)
      ) {
        runId += 1;
      }
      exportRuns.set(point.id, runId);
      previous = point;
    }
  }
  const points =
    privacyRadiusM === 0 ? bundle.points : runs.flatMap((run) => run.map(({ point }) => point));
  const rows = points.map((p) =>
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
      ...(privacyRadiusM > 0 ? [exportRuns.get(p.id) ?? null] : []),
    ]
      .map(csvCell)
      .join(','),
  );
  const columns = privacyRadiusM > 0 ? [...CSV_COLUMNS, 'exportRunId'] : CSV_COLUMNS;
  return [columns.join(','), ...rows].join('\n') + '\n';
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
