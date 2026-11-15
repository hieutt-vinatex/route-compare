/**
 * Compare 2–4 trips (RT-402, RT-403). Pure: metrics in, a comparison table out.
 *
 * Truthfulness rules this file exists to enforce:
 * - Trips are only comparable when the transport mode matches; a car trip is not a benchmark
 *   for a walk. Mixed modes are reported, not silently averaged.
 * - A trip whose GPS coverage is low is flagged. Its distance is "what was measured", so a
 *   difference against it is a difference between measurements, not between routes.
 * - Median / P90 need enough repeats to mean anything (docs/08 RT-403); below that they are null
 *   and the UI shows "—" instead of a number computed from two samples.
 */
import type { TripMetrics } from '../analytics/analyzeTrip';
import type { QualityLabel, TransportMode, Trip } from '../models/types';

/** Fewer repeats than this and a median/P90 says nothing (RT-403). */
export const MIN_TRIPS_FOR_DISTRIBUTION = 3;

export const MAX_COMPARED_TRIPS = 4;
export const MIN_COMPARED_TRIPS = 2;

export interface ComparedTrip {
  readonly trip: Trip;
  readonly metrics: TripMetrics;
}

export interface ComparisonRow {
  readonly tripId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly transportMode: TransportMode;
  readonly elapsedMs: number;
  readonly movingMs: number | null;
  readonly distanceMeasuredM: number;
  readonly avgElapsedKmh: number | null;
  readonly coveragePct: number | null;
  readonly qualityLabel: QualityLabel;
  readonly isIncomplete: boolean;
  readonly importedFromGpx: boolean;
  /** Elapsed minus the fastest trip's elapsed (ms). 0 for the fastest one. */
  readonly elapsedDeltaMs: number;
  /** Measured distance minus the shortest measured distance (m). */
  readonly distanceDeltaM: number;
  /** Below `goodCoveragePct`, deltas against this row are differences between measurements. */
  readonly lowCoverage: boolean;
}

export interface Comparison {
  readonly rows: readonly ComparisonRow[];
  readonly fastestTripId: string | null;
  /** Null until MIN_TRIPS_FOR_DISTRIBUTION comparable trips are selected (RT-403). */
  readonly medianElapsedMs: number | null;
  readonly p90ElapsedMs: number | null;
  /** True when the selection mixes transport modes: the comparison is not like for like. */
  readonly mixedModes: boolean;
  /** Trips whose coverage is below the GOOD threshold. */
  readonly lowCoverageCount: number;
}

export function compareTrips(
  selected: readonly ComparedTrip[],
  lowCoverageBelowPct: number,
): Comparison {
  if (selected.length === 0) {
    return {
      rows: [],
      fastestTripId: null,
      medianElapsedMs: null,
      p90ElapsedMs: null,
      mixedModes: false,
      lowCoverageCount: 0,
    };
  }

  const ordered = [...selected].sort((a, b) => a.metrics.elapsedMs - b.metrics.elapsedMs);
  const fastest = ordered[0];
  const minElapsed = fastest?.metrics.elapsedMs ?? 0;
  const minDistance = Math.min(...ordered.map((t) => t.metrics.distanceMeasuredM));

  const rows = ordered.map((item): ComparisonRow => {
    const { trip, metrics } = item;
    const coverage = metrics.coveragePct;
    return {
      tripId: trip.id,
      name: trip.name,
      startedAt: trip.startedAt,
      transportMode: trip.transportMode,
      elapsedMs: metrics.elapsedMs,
      movingMs: metrics.movingMs,
      distanceMeasuredM: metrics.distanceMeasuredM,
      avgElapsedKmh: metrics.avgElapsedKmh,
      coveragePct: coverage,
      qualityLabel: metrics.qualityLabel,
      isIncomplete: metrics.isIncomplete,
      importedFromGpx: trip.importedFrom === 'GPX',
      elapsedDeltaMs: metrics.elapsedMs - minElapsed,
      distanceDeltaM: metrics.distanceMeasuredM - minDistance,
      lowCoverage: coverage === null || coverage < lowCoverageBelowPct,
    };
  });

  const elapsed = ordered.map((t) => t.metrics.elapsedMs);
  const enough = selected.length >= MIN_TRIPS_FOR_DISTRIBUTION;
  const modes = new Set(selected.map((t) => t.trip.transportMode));

  return {
    rows,
    fastestTripId: fastest?.trip.id ?? null,
    medianElapsedMs: enough ? quantile(elapsed, 0.5) : null,
    p90ElapsedMs: enough ? quantile(elapsed, 0.9) : null,
    mixedModes: modes.size > 1,
    lowCoverageCount: rows.filter((r) => r.lowCoverage).length,
  };
}

/** Nearest-rank quantile on an ascending list — no interpolation between two real trips. */
function quantile(sortedAsc: readonly number[], p: number): number {
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[index] ?? 0;
}
