/**
 * Deterministic replay of persisted raw data (ADR-16): points (by sourceSeq) and boundary events
 * (by seq) share one per-trip sequence, so folding them in order reproduces the live processing
 * exactly — and re-runs it with a newer algorithm when metricsVersion changes.
 */
import {
  applyBoundary,
  createTrackProcessor,
  processSample,
  type BoundaryInput,
  type TrackProcessorState,
} from '../geo/trackProcessor';
import type { GpsConfig } from '../models/gpsConfig';
import type {
  GpsPoint,
  LatLng,
  PointProcessingResult,
  RawGpsSample,
  Trip,
  TripEvent,
  TripEventType,
} from '../models/types';

export interface ReplayedFix {
  readonly pointId: string;
  readonly segmentId: number;
  readonly lat: number;
  readonly lng: number;
  readonly sourceTimestamp: number;
  readonly recordedAt: number;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  readonly distanceAddedM: number;
}

export interface ReplayResult {
  readonly state: TrackProcessorState;
  /** Processing outcome per point id (to refresh stored results after an algorithm change). */
  readonly results: ReadonlyMap<string, PointProcessingResult>;
  /** Accepted fixes in processing order. */
  readonly fixes: readonly ReplayedFix[];
  /** One polyline per segment. */
  readonly segments: readonly (readonly LatLng[])[];
}

const BOUNDARY_KIND: Partial<Record<TripEventType, BoundaryInput['kind']>> = {
  PAGE_HIDDEN: 'PAGE_HIDDEN',
  PAGE_VISIBLE: 'PAGE_VISIBLE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  // Continue after an interruption, or resume after a reload: the watcher restarted.
  RECOVERY: 'WATCH_RESTART',
};

type Item =
  | { readonly seq: number; readonly point: GpsPoint }
  | { readonly seq: number; readonly boundary: BoundaryInput };

function rawOf(p: GpsPoint): RawGpsSample {
  return {
    sourceTimestamp: p.sourceTimestamp,
    recordedAt: p.recordedAt,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracyM: p.accuracyM,
    speedMps: p.speedMps,
    headingDeg: p.headingDeg,
  };
}

export function replayTrack(input: {
  readonly trip: Pick<Trip, 'startedAt' | 'transportMode'>;
  readonly points: readonly GpsPoint[];
  readonly events: readonly TripEvent[];
  readonly config: GpsConfig;
}): ReplayResult {
  const { trip, points, events, config } = input;
  const items: Item[] = points.map((point) => ({ seq: point.sourceSeq, point }));
  for (const event of events) {
    const kind = BOUNDARY_KIND[event.type];
    if (kind !== undefined) items.push({ seq: event.seq, boundary: { kind, at: event.timestamp } });
  }
  items.sort((a, b) => a.seq - b.seq);

  let state = createTrackProcessor(config, {
    startedAt: trip.startedAt,
    transportMode: trip.transportMode,
  });
  const results = new Map<string, PointProcessingResult>();
  const fixes: ReplayedFix[] = [];
  const segments: LatLng[][] = [];
  let currentSegment: number | null = null;

  for (const item of items) {
    if ('boundary' in item) {
      state = applyBoundary(state, item.boundary, config);
      continue;
    }
    const { point } = item;
    const { state: next, outcome } = processSample(state, rawOf(point), config);
    state = next;
    results.set(point.id, {
      accepted: outcome.accepted,
      rejectCode: outcome.rejectCode,
      segmentId: outcome.segmentId,
      derivedSpeedMps: outcome.derivedSpeedMps,
    });
    if (!outcome.accepted || outcome.segmentId === null) continue;
    fixes.push({
      pointId: point.id,
      segmentId: outcome.segmentId,
      lat: point.latitude,
      lng: point.longitude,
      sourceTimestamp: point.sourceTimestamp,
      recordedAt: point.recordedAt,
      accuracyM: point.accuracyM,
      speedMps: point.speedMps,
      distanceAddedM: outcome.distanceAddedM,
    });
    if (outcome.segmentId !== currentSegment) {
      segments.push([]);
      currentSegment = outcome.segmentId;
    }
    segments.at(-1)?.push({ lat: point.latitude, lng: point.longitude });
  }
  return { state, results, fixes, segments };
}
