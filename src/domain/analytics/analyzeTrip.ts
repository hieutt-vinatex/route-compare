/**
 * Trip analytics engine — docs/05 §5–§8 (RT-204, RT-207). Pure: persisted raw data in, metrics
 * out. The final summary of every trip comes from here (metricsVersion = METRICS_VERSION), never
 * from UI state, so it can be recomputed when the algorithm changes (ADR-16).
 */
import type { GpsConfig } from '../models/gpsConfig';
import type { GpsPoint, LatLng, QualityLabel, Trip, TripEvent } from '../models/types';
import { classifyEdges, type ClassifiedEdge } from './classify';
import { replayTrack } from './replay';
import { median, mpsToKmh } from './speed';

export interface TripMetrics {
  readonly distanceMeasuredM: number;
  readonly elapsedMs: number;
  readonly pausedMs: number;
  readonly movingMs: number;
  readonly stoppedMs: number;
  readonly unknownMs: number;
  readonly avgElapsedKmh: number | null;
  readonly avgMovingKmh: number | null;
  readonly maxSpeedKmh: number | null;
  readonly minSpeedKmh: number | null;
  readonly p95SpeedKmh: number | null;
  readonly coveragePct: number | null;
  readonly qualityLabel: QualityLabel;
  /** From the data alone (gaps, hidden page, missing start/end fix, clock resets). */
  readonly isIncomplete: boolean;
  readonly rawCount: number;
  readonly acceptedCount: number;
  readonly segmentCount: number;
  /** Intervals without any GPS (excluding pauses) longer than maxGapMs. */
  readonly largeGapCount: number;
  readonly medianAccuracyM: number | null;
  readonly start: LatLng | null;
  readonly end: LatLng | null;
  /** Classified edges (for charts in M3). */
  readonly edges: readonly ClassifiedEdge[];
  /** App-clock intervals with no GPS and no pause. */
  readonly unmeasured: readonly Interval[];
  /** App-clock user pauses (PAUSE → RESUME, or → End), clipped to the trip. */
  readonly paused: readonly Interval[];
}

export interface Interval {
  readonly from: number;
  readonly to: number;
}

export interface AnalyzeTripInput {
  readonly trip: Pick<Trip, 'startedAt' | 'transportMode'>;
  readonly points: readonly GpsPoint[];
  readonly events: readonly TripEvent[];
  readonly endedAt: number;
  readonly config: GpsConfig;
}

/** Minimum accepted fixes before a quality label above LOW is possible (“dữ liệu quá ít”). */
const MIN_FIXES_FOR_QUALITY = 10;
/** Edges needed before reporting max/min/p95 speeds (§7: “chỉ report khi sample count đủ”). */
const MIN_EDGES_FOR_SPEED_STATS = 3;

export function analyzeTrip(input: AnalyzeTripInput): TripMetrics {
  const { trip, points, events, endedAt, config } = input;
  const start = trip.startedAt;
  const end = Math.max(start, endedAt);
  const elapsedMs = end - start;

  const replay = replayTrack({ trip, points, events, config });
  const edges = classifyEdges(replay.fixes, config);

  const pauses = clipAll(pausedIntervals(events, end), start, end);
  const pausedMs = total(pauses);
  const sumOf = (cls: ClassifiedEdge['cls']): number =>
    total(
      clipAll(
        edges.filter((e) => e.cls === cls),
        start,
        end,
      ),
    );
  const movingMs = sumOf('MOVING');
  const stoppedMs = sumOf('STOPPED');
  const unknownMs = Math.max(0, elapsedMs - pausedMs - movingMs - stoppedMs);

  // Time with neither GPS edges nor a pause.
  const unmeasured = complement(merge([...clipAll(edges, start, end), ...pauses]), start, end);
  const largeGapCount = unmeasured.filter((g) => g.to - g.from > config.maxGapMs).length;
  const trailingGap = unmeasured.find((g) => g.to === end && g.to - g.from > config.maxGapMs);

  const first = replay.fixes[0];
  const last = replay.fixes.at(-1);
  const startPoint = first === undefined ? null : { lat: first.lat, lng: first.lng };
  // No fabricated endpoint: GPS lost long before End → no end point (END_WITHOUT_FIX).
  const endPoint =
    last === undefined || trailingGap !== undefined ? null : { lat: last.lat, lng: last.lng };

  const distance = replay.state.distanceMeasuredM;
  const activeMs = elapsedMs - pausedMs;
  const coveragePct = activeMs > 0 ? (100 * (movingMs + stoppedMs)) / activeMs : null;
  const medianAccuracyM = median(
    replay.fixes.map((f) => f.accuracyM).filter((a): a is number => a !== null),
  );

  // Full-window smoothed speeds only: one raw spike never becomes max/min (§7, review I3).
  const movingSpeeds = edges
    .filter((e) => e.cls === 'MOVING' && e.statSpeedMps !== null)
    .map((e) => e.statSpeedMps ?? 0)
    .sort((a, b) => a - b);
  const enough = movingSpeeds.length >= MIN_EDGES_FOR_SPEED_STATS;
  const positive = movingSpeeds.filter((v) => v > 0);

  return {
    distanceMeasuredM: distance,
    elapsedMs,
    pausedMs,
    movingMs,
    stoppedMs,
    unknownMs,
    avgElapsedKmh:
      elapsedMs > 0 && replay.state.measuredEdgeCount > 0
        ? mpsToKmh(distance / (elapsedMs / 1000))
        : null,
    avgMovingKmh: movingMs > 0 ? mpsToKmh(distance / (movingMs / 1000)) : null,
    maxSpeedKmh: enough ? mpsToKmh(movingSpeeds.at(-1) ?? 0) : null,
    // 0 only with a confirmed stop (BR-07); otherwise the slowest measured movement, or “—”.
    minSpeedKmh:
      stoppedMs > 0 ? 0 : enough && positive.length > 0 ? mpsToKmh(positive[0] ?? 0) : null,
    p95SpeedKmh: enough ? mpsToKmh(percentile(movingSpeeds, 0.95)) : null,
    coveragePct,
    qualityLabel: quality(coveragePct, medianAccuracyM, largeGapCount, replay.fixes.length, config),
    isIncomplete:
      startPoint === null ||
      endPoint === null ||
      largeGapCount > 0 ||
      // Every hidden-page window interrupted the measurement, however short (BRD §6) —
      // except a screen lock during a user pause, which is pause time (review M1).
      total(subtract(clipAll(hiddenIntervals(events, end), start, end), pauses)) > 0 ||
      replay.state.clockResetCount > 0,
    rawCount: points.length,
    acceptedCount: replay.state.acceptedCount,
    segmentCount: replay.state.lastSegmentId,
    largeGapCount,
    medianAccuracyM,
    start: startPoint,
    end: endPoint,
    edges,
    unmeasured,
    paused: pauses,
  };
}

function quality(
  coveragePct: number | null,
  medianAccuracyM: number | null,
  largeGaps: number,
  acceptedFixes: number,
  config: GpsConfig,
): QualityLabel {
  const q = config.quality;
  if (coveragePct === null || acceptedFixes < MIN_FIXES_FOR_QUALITY) return 'LOW';
  if (
    coveragePct >= q.goodCoveragePct &&
    medianAccuracyM !== null &&
    medianAccuracyM <= q.goodMedianAccuracyM &&
    largeGaps <= q.goodMaxLargeGaps
  ) {
    return 'GOOD';
  }
  return coveragePct >= q.fairCoveragePct ? 'FAIR' : 'LOW';
}

/** PAUSE → RESUME intervals (a pause still open at End lasts until End). */
function pausedIntervals(events: readonly TripEvent[], end: number): Interval[] {
  const out: Interval[] = [];
  let pausedAt: number | null = null;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'PAUSE' && pausedAt === null) pausedAt = e.timestamp;
    if (e.type === 'RESUME' && pausedAt !== null) {
      out.push({ from: pausedAt, to: e.timestamp });
      pausedAt = null;
    }
  }
  if (pausedAt !== null) out.push({ from: pausedAt, to: end });
  return out;
}

/** PAGE_HIDDEN → PAGE_VISIBLE (or a watcher restart / End) intervals. */
function hiddenIntervals(events: readonly TripEvent[], end: number): Interval[] {
  const out: Interval[] = [];
  let hiddenAt: number | null = null;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.type === 'PAGE_HIDDEN' && hiddenAt === null) hiddenAt = e.timestamp;
    if ((e.type === 'PAGE_VISIBLE' || e.type === 'RECOVERY') && hiddenAt !== null) {
      out.push({ from: hiddenAt, to: e.timestamp });
      hiddenAt = null;
    }
  }
  if (hiddenAt !== null) out.push({ from: hiddenAt, to: end });
  return out;
}

/** Parts of `intervals` not covered by `cover`. */
function subtract(intervals: readonly Interval[], cover: readonly Interval[]): Interval[] {
  const merged = merge(cover);
  const out: Interval[] = [];
  for (const i of intervals) {
    let cursor = i.from;
    for (const c of merged) {
      if (c.to <= cursor || c.from >= i.to) continue;
      if (c.from > cursor) out.push({ from: cursor, to: c.from });
      cursor = Math.max(cursor, c.to);
    }
    if (cursor < i.to) out.push({ from: cursor, to: i.to });
  }
  return out;
}

function clipAll(intervals: readonly Interval[], from: number, to: number): Interval[] {
  return intervals
    .map((i) => ({ from: Math.max(from, i.from), to: Math.min(to, i.to) }))
    .filter((i) => i.to > i.from);
}

function total(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.to - i.from), 0);
}

function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last !== undefined && i.from <= last.to) last.to = Math.max(last.to, i.to);
    else out.push({ from: i.from, to: i.to });
  }
  return out;
}

function complement(covered: readonly Interval[], from: number, to: number): Interval[] {
  const out: Interval[] = [];
  let cursor = from;
  for (const i of covered) {
    if (i.from > cursor) out.push({ from: cursor, to: i.from });
    cursor = Math.max(cursor, i.to);
  }
  if (cursor < to) out.push({ from: cursor, to });
  return out;
}

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}
