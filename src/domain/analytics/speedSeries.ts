/**
 * Speed timeline for the Trip Detail chart (RT-303, docs/06 §4). Pure: TripMetrics in, plot data out.
 *
 * - One point per classified edge end: km/h for MOVING, 0 for a confirmed STOP (BR-07), `null` for
 *   UNKNOWN or missing speed evidence — a line break, never 0.
 * - Between segments (gap, hidden page, pause, restart) a `null` point breaks the line: the chart
 *   never draws movement that was not measured (BR-04).
 * - Bands shade UNKNOWN time (unmeasured gaps + UNKNOWN edges) and user pauses.
 * - Above `maxPoints`, equal-time buckets take the mean of their speeds; breaks are kept.
 */
import type { ClassifiedEdge } from './classify';
import type { Interval, TripMetrics } from './analyzeTrip';
import { mpsToKmh } from './speed';

export type SpeedSeriesInput = Pick<TripMetrics, 'edges' | 'unmeasured' | 'paused'>;

export interface SpeedPoint {
  /** Minutes since the trip start. */
  readonly tMin: number;
  /** km/h, or null = no evidence / line break. */
  readonly kmh: number | null;
}

export interface SpeedBand {
  readonly fromMin: number;
  readonly toMin: number;
  readonly kind: 'UNKNOWN' | 'PAUSED';
}

export interface SpeedSeries {
  readonly points: readonly SpeedPoint[];
  readonly bands: readonly SpeedBand[];
  /** At least two plotted speeds — otherwise the UI shows “Chưa đủ dữ liệu tốc độ”. */
  readonly hasData: boolean;
  /** Trip end in minutes (last point or band): the x-axis must reach it, or trailing lost GPS hides. */
  readonly endMin: number;
}

export const SPEED_SERIES_MAX_POINTS = 600;
/** Floor on the bucket count when many breaks eat into the point budget. */
const MIN_BUCKETS = 50;

interface RawPoint {
  readonly t: number;
  readonly kmh: number | null;
}

export function buildSpeedSeries(
  input: SpeedSeriesInput,
  startedAt: number,
  maxPoints: number = SPEED_SERIES_MAX_POINTS,
): SpeedSeries {
  const edges = [...input.edges].sort((a, b) => a.from - b.from);
  const raw: RawPoint[] = [];
  let previous: ClassifiedEdge | undefined;
  for (const edge of edges) {
    if (previous !== undefined && edge.from !== previous.to) {
      raw.push({ t: (previous.to + edge.from) / 2, kmh: null });
    }
    raw.push({ t: edge.to, kmh: edgeKmh(edge) });
    previous = edge;
  }

  const plotted = raw.length > maxPoints ? bucket(raw, maxPoints) : raw;
  const toMin = (t: number): number => (t - startedAt) / 60_000;
  const points = plotted.map((p) => ({ tMin: toMin(p.t), kmh: p.kmh }));

  const unknown = merge([
    ...input.unmeasured,
    ...edges.filter((e) => e.cls === 'UNKNOWN').map((e) => ({ from: e.from, to: e.to })),
  ]);
  const bands: SpeedBand[] = [
    ...unknown.map((i) => ({
      fromMin: toMin(i.from),
      toMin: toMin(i.to),
      kind: 'UNKNOWN' as const,
    })),
    ...input.paused.map((i) => ({
      fromMin: toMin(i.from),
      toMin: toMin(i.to),
      kind: 'PAUSED' as const,
    })),
  ].sort((a, b) => a.fromMin - b.fromMin);

  const endMin = Math.max(0, ...points.map((p) => p.tMin), ...bands.map((b) => b.toMin));
  return { points, bands, endMin, hasData: points.filter((p) => p.kmh !== null).length >= 2 };
}

function edgeKmh(edge: ClassifiedEdge): number | null {
  if (edge.cls === 'STOPPED') return 0;
  if (edge.cls === 'UNKNOWN' || edge.speedMps === null) return null;
  return mpsToKmh(edge.speedMps);
}

/**
 * Equal-time buckets → mean speed per bucket; every run of nulls stays one break.
 * shortcut: each break costs up to 2 extra points, so a trip with hundreds of gaps can exceed
 * maxPoints (e.g. 1 000 points for a gap every 10 s); Chart.js copes — cap breaks if it ever lags.
 */
function bucket(raw: readonly RawPoint[], maxPoints: number): RawPoint[] {
  const first = raw[0];
  const last = raw.at(-1);
  if (first === undefined || last === undefined) return [];
  let breaks = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i]?.kmh === null && raw[i - 1]?.kmh !== null) breaks += 1;
  }
  const buckets = Math.max(MIN_BUCKETS, maxPoints - 2 * breaks);
  const width = Math.max(1, (last.t - first.t) / buckets);

  const out: RawPoint[] = [];
  let sum = 0;
  let timeSum = 0;
  let count = 0;
  let current = 0;
  const flush = (): void => {
    if (count > 0) out.push({ t: timeSum / count, kmh: sum / count });
    sum = 0;
    timeSum = 0;
    count = 0;
  };
  for (const p of raw) {
    const index = Math.min(buckets - 1, Math.floor((p.t - first.t) / width));
    if (index !== current) {
      flush();
      current = index;
    }
    if (p.kmh === null) {
      flush();
      if (out.at(-1)?.kmh !== null) out.push(p);
    } else {
      sum += p.kmh;
      timeSum += p.t;
      count += 1;
    }
  }
  flush();
  return out;
}

function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.to > i.from).sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const i of sorted) {
    const tail = out.at(-1);
    if (tail !== undefined && i.from <= tail.to) {
      out[out.length - 1] = { from: tail.from, to: Math.max(tail.to, i.to) };
    } else {
      out.push(i);
    }
  }
  return out;
}
