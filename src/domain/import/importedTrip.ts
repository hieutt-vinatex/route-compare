/**
 * Turns fixes read from a track file into the same shape RouteTrack records itself (RT-404),
 * so History, Detail, the charts and the analytics engine need no special case: one Trip, raw
 * GpsPoints and the boundary events that forbid bridging. Pure — no DOM, no IndexedDB.
 *
 * An imported track is NOT a RouteTrack measurement. It keeps `importedFrom`, and the analysis
 * runs under `importConfig()` because the file's own sampling rate, not RouteTrack's live
 * watchPosition, decides what counts as a gap.
 */
import { analyzeTrip } from '../analytics/analyzeTrip';
import { median } from '../analytics/speed';
import type { GpsConfig } from '../models/gpsConfig';
import type { GpsPoint, ImportSource, TransportMode, Trip, TripEvent } from '../models/types';
import { applyMetrics, createTrip } from '../trip/tripFactory';

/** One timed fix read from a track file. Produced by the reader adapter, consumed here. */
export interface ImportedFix {
  readonly lat: number;
  readonly lng: number;
  /** Epoch ms from the file's own timestamp. */
  readonly timestamp: number;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  /** Index of the file's own track segment: the logger's "I stopped here" breaks. */
  readonly segmentIndex: number;
}

export interface ImportedTripData {
  readonly trip: Trip;
  readonly points: readonly GpsPoint[];
  readonly events: readonly TripEvent[];
}

export interface BuildImportedTripInput {
  readonly fixes: readonly ImportedFix[];
  readonly name: string;
  readonly transportMode: TransportMode;
  readonly source: ImportSource;
  /** Trip id, then one id per point and per event, in that order. */
  readonly ids: () => string;
  /** App clock, for createdAt/updatedAt only — never for the track's own timeline. */
  readonly now: number;
  /** Base config; the trip is analysed under `importConfig(fixes, config)`. */
  readonly config: GpsConfig;
}

/**
 * A file that samples every 30 s has not "lost GPS" for 30 s — that is simply its rate, while
 * RouteTrack's own 20 s rule assumes a continuous watchPosition. Judge a gap against what the
 * file itself does: anything beyond `GAP_INTERVAL_FACTOR` × its median interval really is a
 * break in recording. Derived from the points alone, so re-analysis reproduces it exactly.
 */
export const GAP_INTERVAL_FACTOR = 3;

export interface ImportSampling {
  readonly timestamp: number;
  readonly accuracyM?: number | null;
}

export function importConfig(fixes: readonly ImportSampling[], base: GpsConfig): GpsConfig {
  const intervals: number[] = [];
  for (let i = 1; i < fixes.length; i += 1) {
    const dt = (fixes[i]?.timestamp ?? 0) - (fixes[i - 1]?.timestamp ?? 0);
    if (dt > 0) intervals.push(dt);
  }
  const typical = median(intervals) ?? 0;
  return {
    ...base,
    maxGapMs: Math.max(base.maxGapMs, Math.ceil(GAP_INTERVAL_FACTOR * typical)),
    // The file carries one clock, so there is nothing to calibrate against the app clock and no
    // reason to spend the first fix on it.
    clock: { ...base.clock, minSamples: 1 },
    // GPX has no accuracy field of its own; a file that states none is still usable data.
    requireAccuracy: fixes.length > 0 && hasAnyAccuracy(fixes),
  };
}

function hasAnyAccuracy(fixes: readonly ImportSampling[]): boolean {
  return fixes.some((f) => f.accuracyM !== null && f.accuracyM !== undefined);
}

export function buildImportedTrip(input: BuildImportedTripInput): ImportedTripData {
  const { fixes, name, transportMode, source, ids, now } = input;
  const first = fixes[0];
  const last = fixes.at(-1);
  if (first === undefined || last === undefined) {
    throw new RangeError('Không có điểm nào để nhập.');
  }

  const tripId = ids();
  const base = createTrip({ id: tripId, name, transportMode, startedAt: first.timestamp });
  const points: GpsPoint[] = [];
  const events: TripEvent[] = [];
  let seq = 0;

  events.push(event(ids(), tripId, seq++, first.timestamp, 'START', { transportMode }));

  let previousSegment = first.segmentIndex;
  for (const fix of fixes) {
    if (fix.segmentIndex !== previousSegment) {
      // The file closed a track segment: a new segment starts and nothing bridges the break,
      // exactly as a restarted watcher does live (replay maps RECOVERY → WATCH_RESTART).
      events.push(
        event(ids(), tripId, seq++, fix.timestamp, 'RECOVERY', { reason: 'IMPORTED_SEGMENT' }),
      );
      previousSegment = fix.segmentIndex;
    }
    points.push({
      id: ids(),
      tripId,
      sourceSeq: seq++,
      // One clock: the file's timestamps are both the fix time and the time we "received" it.
      sourceTimestamp: fix.timestamp,
      recordedAt: fix.timestamp,
      latitude: fix.lat,
      longitude: fix.lng,
      accuracyM: fix.accuracyM,
      speedMps: fix.speedMps,
      headingDeg: null,
      segmentId: null,
      accepted: false,
      rejectCode: null,
      derivedSpeedMps: null,
    });
  }

  events.push(event(ids(), tripId, seq, last.timestamp, 'END', null));

  // Same engine as a live End, so an imported trip's summary means the same thing everywhere.
  const metrics = analyzeTrip({
    trip: { startedAt: first.timestamp, transportMode },
    points,
    events,
    endedAt: last.timestamp,
    config: importConfig(fixes, input.config),
  });
  const trip = applyMetrics(base, metrics, {
    endedAt: last.timestamp,
    hadInterruption: false,
    hadStorageError: false,
  });

  return {
    trip: { ...trip, importedFrom: source, createdAt: now, updatedAt: now },
    points,
    events,
  };
}

function event(
  id: string,
  tripId: string,
  seq: number,
  timestamp: number,
  type: TripEvent['type'],
  metadata: TripEvent['metadata'],
): TripEvent {
  return { id, tripId, seq, timestamp, type, metadata };
}
