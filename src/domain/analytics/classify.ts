/**
 * Edge classification MOVING / STOPPED / UNKNOWN — docs/05 §6 (reworked after review C1).
 *
 * Speed evidence for an edge (consecutive accepted fixes of one segment):
 * - the provider speed (coords.speed, Doppler) at the edge's end fix when the device reports it;
 * - otherwise the drift-filter chunk speed: distance between consecutive distance anchors divided
 *   by the time between them ("displacement/dt of accepted points" resolved beyond the position
 *   uncertainty). Movement still inside the uncertainty is NOT evidence of 0 km/h: edges after the
 *   last anchor of a segment stay unresolved (null → UNKNOWN).
 *
 * STOPPED needs evidence over a whole dwell: a window of ≥ stop.dwellMs whose fixes all stay within
 * max(stop.radiusM, median accuracy) of the window centroid AND whose net speed (centroid of the
 * first third → centroid of the last third) is below stop.speedKmh. A shorter stop is never STOPPED.
 *
 * Otherwise an edge is MOVING when its speed (median of 3 around it) reaches stop.speedKmh, else
 * UNKNOWN. Speed statistics (max/min/p95) use per-fix speeds measured over a base of at least
 * liveSpeedWindowMs and beyond the position uncertainty (provider speed when reported), then a
 * centred median over `speedStatsWindow` edges with FULL windows only — so a single spike, also at a
 * segment start or end, never survives (a spike only touches isolated values on that long base).
 * Durations use the app clock (recordedAt), the same clock as elapsed and pauses.
 */
import { isCompactAndSlow, resolvedSpeedMps } from '../geo/motionEvidence';
import type { GpsConfig } from '../models/gpsConfig';
import type { ReplayedFix } from './replay';
import { median } from './speed';

export type EdgeClass = 'MOVING' | 'STOPPED' | 'UNKNOWN';

export interface ClassifiedEdge {
  /** App-clock interval [from, to] between two consecutive accepted fixes of one segment. */
  readonly from: number;
  readonly to: number;
  readonly cls: EdgeClass;
  /** Speed evidence (m/s) used to classify the edge, or null when unresolved. */
  readonly speedMps: number | null;
  /** Full-window median speed for statistics (max/min/p95), or null near segment ends. */
  readonly statSpeedMps: number | null;
}

export function classifyEdges(fixes: readonly ReplayedFix[], config: GpsConfig): ClassifiedEdge[] {
  const edges: ClassifiedEdge[] = [];
  let start = 0;
  while (start < fixes.length) {
    let end = start;
    const segmentId = fixes[start]?.segmentId;
    while (end + 1 < fixes.length && fixes[end + 1]?.segmentId === segmentId) end += 1;
    edges.push(...classifySegment(fixes.slice(start, end + 1), config));
    start = end + 1;
  }
  return edges;
}

function classifySegment(seg: readonly ReplayedFix[], config: GpsConfig): ClassifiedEdge[] {
  const n = seg.length;
  if (n < 2) return [];
  const slowMps = config.stop.speedKmh / 3.6;

  // edgeSpeed[i] = evidence for the edge (i-1 → i); index 0 has no edge.
  const chunk = chunkSpeeds(seg);
  const edgeSpeed: (number | null)[] = seg.map((fix, i) =>
    i === 0 ? null : (fix.speedMps ?? chunk[i] ?? null),
  );
  const stopped = confirmedStopFixes(seg, config);
  const statBase: (number | null)[] = seg.map((fix, i) =>
    i === 0 ? null : (fix.speedMps ?? resolvedSpeedMps(seg, i, config)),
  );
  const half = Math.floor(Math.max(1, config.speedStatsWindow) / 2);

  const edges: ClassifiedEdge[] = [];
  for (let i = 1; i < n; i += 1) {
    const a = seg[i - 1];
    const b = seg[i];
    if (a === undefined || b === undefined) continue;
    const local = median(definedOf([edgeSpeed[i - 1], edgeSpeed[i], edgeSpeed[i + 1]]));
    const cls: EdgeClass =
      stopped.has(i - 1) && stopped.has(i)
        ? 'STOPPED'
        : local !== null && local >= slowMps
          ? 'MOVING'
          : 'UNKNOWN';
    // Statistics: only windows that lie fully inside the segment and have evidence everywhere.
    let statSpeedMps: number | null = null;
    if (i - half >= 1 && i + half <= n - 1) {
      const window = statBase.slice(i - half, i + half + 1);
      if (window.every((v) => v !== null)) statSpeedMps = median(definedOf(window));
    }
    edges.push({ from: a.recordedAt, to: b.recordedAt, cls, speedMps: local, statSpeedMps });
  }
  return edges;
}

/** Speed of each drift-filter chunk, assigned to every edge inside it (null after the last anchor). */
function chunkSpeeds(seg: readonly ReplayedFix[]): (number | null)[] {
  const out: (number | null)[] = seg.map(() => null);
  let anchor = 0;
  for (let i = 1; i < seg.length; i += 1) {
    const fix = seg[i];
    const from = seg[anchor];
    if (fix === undefined || from === undefined || fix.distanceAddedM <= 0) continue;
    const dtS = (fix.sourceTimestamp - from.sourceTimestamp) / 1000;
    const speed = dtS > 0 ? fix.distanceAddedM / dtS : null;
    for (let k = anchor + 1; k <= i; k += 1) out[k] = speed;
    anchor = i;
  }
  return out;
}

/** Indices of fixes inside a window that proves a stop (compact AND slow for ≥ dwell). */
function confirmedStopFixes(seg: readonly ReplayedFix[], config: GpsConfig): Set<number> {
  const out = new Set<number>();
  let k = 0;
  for (let i = 0; i < seg.length; i += 1) {
    const first = seg[i];
    if (first === undefined) continue;
    if (k <= i) k = i + 1;
    while (
      k < seg.length &&
      (seg[k]?.recordedAt ?? Infinity) - first.recordedAt < config.stop.dwellMs
    ) {
      k += 1;
    }
    if (k >= seg.length) break;
    const window = seg.slice(i, k + 1);
    if (isCompactAndSlow(window, config)) for (let j = i; j <= k; j += 1) out.add(j);
  }
  return out;
}

function definedOf(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => v !== null && v !== undefined);
}
