import type { TripMetrics } from '../analytics/analyzeTrip';
import { METRICS_VERSION, PROVISIONAL_METRICS_VERSION } from '../models/gpsConfig';
import type { TransportMode, Trip } from '../models/types';

export interface NewTripInput {
  readonly id: string;
  readonly name: string;
  readonly transportMode: TransportMode;
  /** App clock when the user pressed Start. Startup time before the first fix is UNKNOWN. */
  readonly startedAt: number;
}

export function createTrip(input: NewTripInput): Trip {
  return {
    id: input.id,
    name: input.name,
    transportMode: input.transportMode,
    routeGroupId: null,
    routeVariantLabel: null,
    status: 'STARTING',
    startedAt: input.startedAt,
    endedAt: null,
    startLat: null,
    startLng: null,
    endLat: null,
    endLng: null,
    distanceMeasuredM: 0,
    elapsedMs: 0,
    pausedMs: 0,
    movingMs: null,
    stoppedMs: null,
    unknownMs: null,
    avgElapsedKmh: null,
    avgMovingKmh: null,
    maxSpeedKmh: null,
    minSpeedKmh: null,
    coveragePct: null,
    qualityLabel: null,
    isIncomplete: false,
    metricsVersion: PROVISIONAL_METRICS_VERSION,
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
  };
}

export interface FinalizeFlags {
  readonly endedAt: number;
  /** GPS permission lost, reload recovery, failed save… — not visible in the raw data alone. */
  readonly hadInterruption: boolean;
  readonly hadStorageError: boolean;
}

/** Final COMPLETED trip from analytics computed on the persisted raw data (docs/05 §5–§8). */
export function applyMetrics(trip: Trip, metrics: TripMetrics, flags: FinalizeFlags): Trip {
  return {
    ...trip,
    status: 'COMPLETED',
    endedAt: flags.endedAt,
    startLat: metrics.start?.lat ?? null,
    startLng: metrics.start?.lng ?? null,
    // No fabricated endpoint (END_WITHOUT_FIX).
    endLat: metrics.end?.lat ?? null,
    endLng: metrics.end?.lng ?? null,
    distanceMeasuredM: metrics.distanceMeasuredM,
    elapsedMs: metrics.elapsedMs,
    pausedMs: metrics.pausedMs,
    movingMs: metrics.movingMs,
    stoppedMs: metrics.stoppedMs,
    unknownMs: metrics.unknownMs,
    avgElapsedKmh: metrics.avgElapsedKmh,
    avgMovingKmh: metrics.avgMovingKmh,
    maxSpeedKmh: metrics.maxSpeedKmh,
    minSpeedKmh: metrics.minSpeedKmh,
    coveragePct: metrics.coveragePct,
    qualityLabel: metrics.qualityLabel,
    isIncomplete: metrics.isIncomplete || flags.hadInterruption || flags.hadStorageError,
    metricsVersion: METRICS_VERSION,
    updatedAt: flags.endedAt,
  };
}
