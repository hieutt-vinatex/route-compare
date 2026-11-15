/**
 * Read a RouteTrack backup file (RT-404/RT-405). A backup is untrusted input: every row is
 * validated here before it can reach IndexedDB, and anything malformed is rejected with a reason
 * instead of being written half-way. Pure — no DOM, no storage.
 */
import { BACKUP_SCHEMA_VERSION, type TripBundle } from './serialize';
import {
  REJECT_CODES,
  TRANSPORT_MODES,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES,
  type GpsPoint,
  type QualityLabel,
  type RejectCode,
  type Trip,
  type TripEvent,
} from '../models/types';

const PERSISTED_STATUSES = TRIP_STATUSES.filter(
  (s): s is Exclude<(typeof TRIP_STATUSES)[number], 'IDLE'> => s !== 'IDLE',
);

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export function parseBackup(text: string): readonly TripBundle[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupParseError('Tệp không phải JSON hợp lệ.');
  }
  const root = asRecord(raw, 'tệp sao lưu');
  if (root['app'] !== 'routetrack') {
    throw new BackupParseError('Tệp không phải bản sao lưu RouteTrack.');
  }
  const version = root['schemaVersion'];
  if (typeof version !== 'number' || version > BACKUP_SCHEMA_VERSION) {
    throw new BackupParseError(
      `Bản sao lưu dùng định dạng phiên bản ${String(version)}, bản cài này chỉ đọc tới ${String(BACKUP_SCHEMA_VERSION)}.`,
    );
  }
  const trips = root['trips'];
  if (!Array.isArray(trips)) throw new BackupParseError('Tệp sao lưu thiếu danh sách hành trình.');
  return trips.map((bundle, i) => parseBundle(bundle, i));
}

function parseBundle(value: unknown, index: number): TripBundle {
  const where = `hành trình #${String(index + 1)}`;
  const record = asRecord(value, where);
  const trip = parseTrip(record['trip'], where);
  const points = asArray(record['points'], `${where} (điểm GPS)`).map((p) =>
    parsePoint(p, trip.id, where),
  );
  const events = asArray(record['events'], `${where} (sự kiện)`).map((e) =>
    parseEvent(e, trip.id, where),
  );
  return { trip, points, events };
}

function parseTrip(value: unknown, where: string): Trip {
  const r = asRecord(value, where);
  const startedAt = num(r['startedAt'], `${where}: startedAt`);
  return {
    id: str(r['id'], `${where}: id`),
    name: str(r['name'], `${where}: name`),
    transportMode: oneOf(r['transportMode'], TRANSPORT_MODES, `${where}: transportMode`),
    routeGroupId: strOrNull(r['routeGroupId']),
    routeVariantLabel: strOrNull(r['routeVariantLabel']),
    // IDLE is a controller state and is never persisted, so a backup must not carry it.
    status: oneOf(r['status'], PERSISTED_STATUSES, `${where}: status`),
    startedAt,
    endedAt: numOrNull(r['endedAt']),
    startLat: numOrNull(r['startLat']),
    startLng: numOrNull(r['startLng']),
    endLat: numOrNull(r['endLat']),
    endLng: numOrNull(r['endLng']),
    distanceMeasuredM: num(r['distanceMeasuredM'], `${where}: distanceMeasuredM`),
    elapsedMs: num(r['elapsedMs'], `${where}: elapsedMs`),
    pausedMs: num(r['pausedMs'], `${where}: pausedMs`),
    movingMs: numOrNull(r['movingMs']),
    stoppedMs: numOrNull(r['stoppedMs']),
    unknownMs: numOrNull(r['unknownMs']),
    avgElapsedKmh: numOrNull(r['avgElapsedKmh']),
    avgMovingKmh: numOrNull(r['avgMovingKmh']),
    maxSpeedKmh: numOrNull(r['maxSpeedKmh']),
    minSpeedKmh: numOrNull(r['minSpeedKmh']),
    coveragePct: numOrNull(r['coveragePct']),
    qualityLabel: qualityOrNull(r['qualityLabel']),
    isIncomplete: r['isIncomplete'] === true,
    metricsVersion: num(r['metricsVersion'], `${where}: metricsVersion`),
    importedFrom: r['importedFrom'] === 'GPX' ? 'GPX' : null,
    createdAt: numOr(r['createdAt'], startedAt),
    updatedAt: numOr(r['updatedAt'], startedAt),
  };
}

function parsePoint(value: unknown, tripId: string, where: string): GpsPoint {
  const r = asRecord(value, `${where}: điểm GPS`);
  const lat = num(r['latitude'], `${where}: latitude`);
  const lng = num(r['longitude'], `${where}: longitude`);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new BackupParseError(`${where}: toạ độ ngoài phạm vi hợp lệ.`);
  }
  return {
    id: str(r['id'], `${where}: điểm GPS id`),
    // A backup always belongs to the trip it is nested under, whatever the row says.
    tripId,
    sourceSeq: num(r['sourceSeq'], `${where}: sourceSeq`),
    sourceTimestamp: num(r['sourceTimestamp'], `${where}: sourceTimestamp`),
    recordedAt: num(r['recordedAt'], `${where}: recordedAt`),
    latitude: lat,
    longitude: lng,
    accuracyM: numOrNull(r['accuracyM']),
    speedMps: numOrNull(r['speedMps']),
    headingDeg: numOrNull(r['headingDeg']),
    segmentId: numOrNull(r['segmentId']),
    accepted: r['accepted'] === true,
    rejectCode: rejectOrNull(r['rejectCode']),
    derivedSpeedMps: numOrNull(r['derivedSpeedMps']),
  };
}

function parseEvent(value: unknown, tripId: string, where: string): TripEvent {
  const r = asRecord(value, `${where}: sự kiện`);
  return {
    id: str(r['id'], `${where}: sự kiện id`),
    tripId,
    seq: num(r['seq'], `${where}: seq`),
    timestamp: num(r['timestamp'], `${where}: timestamp`),
    type: oneOf(r['type'], TRIP_EVENT_TYPES, `${where}: type`),
    metadata: isRecord(r['metadata']) ? (r['metadata'] as TripEvent['metadata']) : null,
  };
}

// ----------------------------------------------------------------- primitives

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BackupParseError(`${where}: dữ liệu không đúng định dạng.`);
  return value;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new BackupParseError(`${where}: thiếu danh sách.`);
  return value;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new BackupParseError(`${where}: thiếu giá trị văn bản.`);
  }
  return value;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BackupParseError(`${where}: thiếu giá trị số.`);
  }
  return value;
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BackupParseError(`${where}: giá trị không hợp lệ.`);
  }
  return value as T;
}

function qualityOrNull(value: unknown): QualityLabel | null {
  return value === 'GOOD' || value === 'FAIR' || value === 'LOW' ? value : null;
}

function rejectOrNull(value: unknown): RejectCode | null {
  return typeof value === 'string' && REJECT_CODES.includes(value as RejectCode)
    ? (value as RejectCode)
    : null;
}
