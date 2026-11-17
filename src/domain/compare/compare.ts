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
  readonly movingMs: number;
  readonly stoppedMs: number;
  readonly pausedMs: number;
  readonly unknownMs: number;
  readonly avgMovingKmh: number | null;
  readonly maxSpeedKmh: number | null;
  readonly minSpeedKmh: number | null;
  readonly routeVariantLabel: string | null;
  readonly elapsedDeltaPct: number | null;
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
  readonly differentDates: boolean;
  readonly differentDepartureWindows: boolean;
  /** Trips whose coverage is below the GOOD threshold. */
  readonly lowCoverageCount: number;
}

export function compareTrips(
  selected: readonly ComparedTrip[],
  lowCoverageBelowPct: number,
  options: CompareOptions = DEFAULT_COMPARE_OPTIONS,
): Comparison {
  if (selected.length === 0) {
    return {
      rows: [],
      fastestTripId: null,
      medianElapsedMs: null,
      p90ElapsedMs: null,
      mixedModes: false,
      differentDates: false,
      differentDepartureWindows: false,
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
      stoppedMs: metrics.stoppedMs,
      pausedMs: metrics.pausedMs,
      unknownMs: metrics.unknownMs,
      avgMovingKmh: metrics.avgMovingKmh,
      maxSpeedKmh: metrics.maxSpeedKmh,
      minSpeedKmh: metrics.minSpeedKmh,
      routeVariantLabel: trip.routeVariantLabel,
      elapsedDeltaPct:
        minElapsed > 0 ? (100 * (metrics.elapsedMs - minElapsed)) / minElapsed : null,
      distanceMeasuredM: metrics.distanceMeasuredM,
      avgElapsedKmh: metrics.avgElapsedKmh,
      coveragePct: coverage,
      qualityLabel: metrics.qualityLabel,
      isIncomplete: trip.isIncomplete || metrics.isIncomplete,
      importedFromGpx: trip.importedFrom === 'GPX',
      elapsedDeltaMs: metrics.elapsedMs - minElapsed,
      distanceDeltaM: metrics.distanceMeasuredM - minDistance,
      lowCoverage: coverage === null || coverage < lowCoverageBelowPct,
    };
  });

  const elapsed = ordered.map((t) => t.metrics.elapsedMs);
  const partitions = summarizeVariants(selected, lowCoverageBelowPct, options);
  const enough = partitions.length === 1 && partitions[0]?.medianElapsedMs !== null;
  const modes = new Set(selected.map((t) => t.trip.transportMode));

  return {
    rows,
    fastestTripId: fastest?.trip.id ?? null,
    medianElapsedMs: enough ? quantile(elapsed, 0.5) : null,
    p90ElapsedMs: enough ? quantile(elapsed, 0.9) : null,
    mixedModes: modes.size > 1,
    differentDates: new Set(selected.map(({ trip }) => localDate(trip.startedAt))).size > 1,
    differentDepartureWindows:
      new Set(selected.map(({ trip }) => departureWindow(trip.startedAt, options))).size > 1,
    lowCoverageCount: rows.filter((r) => r.lowCoverage).length,
  };
}

/** Nearest-rank quantile on an ascending list — no interpolation between two real trips. */
function quantile(sortedAsc: readonly number[], p: number): number {
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[index] ?? 0;
}

export interface CompareOptions {
  readonly departureWindowMinutes: number;
}

/** Local device time, buckets anchored at midnight: 00–02, 02–04, … */
export const DEFAULT_COMPARE_OPTIONS: CompareOptions = { departureWindowMinutes: 120 };

export interface VariantDistribution {
  readonly routeVariantLabel: string | null;
  readonly transportMode: TransportMode;
  readonly departureWindowLabel: string;
  readonly sampleCount: number;
  readonly dateCount: number;
  readonly medianElapsedMs: number | null;
  readonly p90ElapsedMs: number | null;
  readonly stddevElapsedMs: number | null;
  readonly sufficientForEvaluation: boolean;
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function windowWidth(options: CompareOptions): number {
  return Number.isFinite(options.departureWindowMinutes) && options.departureWindowMinutes > 0
    ? Math.min(1440, Math.max(1, Math.round(options.departureWindowMinutes)))
    : DEFAULT_COMPARE_OPTIONS.departureWindowMinutes;
}

function departureWindow(timestamp: number, options: CompareOptions): number {
  const date = new Date(timestamp);
  return Math.floor((date.getHours() * 60 + date.getMinutes()) / windowWidth(options));
}

function windowLabel(timestamp: number, options: CompareOptions): string {
  const start = departureWindow(timestamp, options) * windowWidth(options);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${time(start)}–${time(Math.min(1440, start + windowWidth(options)))}`;
}

/** The caller supplies ONE A→B group. Never pool modes, named road variants or time windows. */
export function summarizeVariants(
  trips: readonly ComparedTrip[],
  lowCoverageBelowPct: number,
  options: CompareOptions = DEFAULT_COMPARE_OPTIONS,
): readonly VariantDistribution[] {
  const groups = new Map<string, ComparedTrip[]>();
  for (const item of trips) {
    const key = JSON.stringify([
      item.trip.routeVariantLabel?.trim() || null,
      item.trip.transportMode,
      departureWindow(item.trip.startedAt, options),
    ]);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((items) => {
    const first = items[0];
    if (first === undefined) throw new Error('Empty comparison partition');
    const label = first.trip.routeVariantLabel?.trim() || null;
    const elapsed = items.map((item) => item.metrics.elapsedMs).sort((a, b) => a - b);
    const mean = elapsed.reduce((sum, value) => sum + value, 0) / items.length;
    const enough = label !== null && items.length >= MIN_TRIPS_FOR_DISTRIBUTION;
    const dateCount = new Set(items.map((item) => localDate(item.trip.startedAt))).size;
    return {
      routeVariantLabel: label,
      transportMode: first.trip.transportMode,
      departureWindowLabel: windowLabel(first.trip.startedAt, options),
      sampleCount: items.length,
      dateCount,
      medianElapsedMs: enough ? quantile(elapsed, 0.5) : null,
      p90ElapsedMs: enough ? quantile(elapsed, 0.9) : null,
      stddevElapsedMs: enough
        ? Math.sqrt(elapsed.reduce((sum, value) => sum + (value - mean) ** 2, 0) / items.length)
        : null,
      sufficientForEvaluation:
        label !== null &&
        items.length >= 5 &&
        dateCount >= 3 &&
        items.every(
          ({ trip, metrics }) =>
            metrics.qualityLabel === 'GOOD' &&
            !trip.isIncomplete &&
            !metrics.isIncomplete &&
            metrics.coveragePct !== null &&
            metrics.coveragePct >= lowCoverageBelowPct,
        ),
    };
  });
}
