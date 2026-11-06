/**
 * Motion evidence shared by live speed (trackProcessor) and trip analytics (classify) — docs/05 §6.
 *
 * - A displacement counts as speed evidence only once it exceeds the combined position uncertainty
 *   √(accA² + accB²) over a base of at least liveSpeedWindowMs. Movement still inside the
 *   uncertainty is NOT evidence of 0 km/h (BR-07): it is "unknown".
 * - 0 km/h needs a confirmed stop: a window of ≥ stop.dwellMs whose fixes all stay within
 *   max(stop.radiusM, median accuracy) of the centroid AND whose net speed (centroid of the first
 *   third → centroid of the last third) is below stop.speedKmh.
 */
import type { GpsConfig } from '../models/gpsConfig';
import type { LatLng } from '../models/types';
import { median } from '../analytics/speed';
import { haversineM } from './haversine';

/** Minimal fix shape (AcceptedFix, ReplayedFix…), oldest first, one segment. */
export interface MotionFix {
  readonly lat: number;
  readonly lng: number;
  /** Device clock — differences only. */
  readonly sourceTimestamp: number;
  /** App clock. */
  readonly recordedAt: number;
  readonly accuracyM: number | null;
}

/**
 * Displacement speed (m/s) ending at fixes[endIndex], from the latest earlier fix that is at least
 * `minBaseMs` older (default liveSpeedWindowMs) and farther than the combined position uncertainty
 * (look-back bounded to 4 × stop.dwellMs); null when no such fix exists.
 */
export function resolvedSpeedMps(
  fixes: readonly MotionFix[],
  endIndex: number,
  config: GpsConfig,
  minBaseMs: number = config.liveSpeedWindowMs,
): number | null {
  const end = fixes[endIndex];
  if (end === undefined) return null;
  const maxLookbackMs = 4 * config.stop.dwellMs;
  for (let j = endIndex - 1; j >= 0; j -= 1) {
    const from = fixes[j];
    if (from === undefined) continue;
    const dtMs = end.sourceTimestamp - from.sourceTimestamp;
    if (dtMs > maxLookbackMs) break;
    if (dtMs < minBaseMs) continue;
    const movedM = haversineM(from, end);
    if (movedM >= Math.hypot(from.accuracyM ?? 0, end.accuracyM ?? 0))
      return movedM / (dtMs / 1000);
  }
  return null;
}

/** True when the dwell window ending at fixes[endIndex] proves a stop (compact AND slow). */
export function stopConfirmedAt(
  fixes: readonly MotionFix[],
  endIndex: number,
  config: GpsConfig,
): boolean {
  const end = fixes[endIndex];
  if (end === undefined) return false;
  for (let start = endIndex - 1; start >= 0; start -= 1) {
    const first = fixes[start];
    if (first === undefined) return false;
    if (end.recordedAt - first.recordedAt >= config.stop.dwellMs) {
      return isCompactAndSlow(fixes.slice(start, endIndex + 1), config);
    }
  }
  return false;
}

export function isCompactAndSlow(window: readonly MotionFix[], config: GpsConfig): boolean {
  if (window.length === 0) return false;
  const center = centroid(window);
  const accuracy = median(definedOf(window.map((f) => f.accuracyM))) ?? 0;
  const radius = Math.max(config.stop.radiusM, accuracy);
  if (window.some((f) => haversineM(center, f) > radius)) return false;
  const group = Math.max(1, Math.floor(window.length / 3));
  const head = window.slice(0, group);
  const tail = window.slice(-group);
  const dtS = (meanTime(tail) - meanTime(head)) / 1000;
  if (dtS <= 0) return false;
  return haversineM(centroid(head), centroid(tail)) / dtS < config.stop.speedKmh / 3.6;
}

function centroid(fixes: readonly MotionFix[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const f of fixes) {
    lat += f.lat;
    lng += f.lng;
  }
  return { lat: lat / fixes.length, lng: lng / fixes.length };
}

function meanTime(fixes: readonly MotionFix[]): number {
  return fixes.reduce((sum, f) => sum + f.sourceTimestamp, 0) / fixes.length;
}

function definedOf(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => v !== null && v !== undefined);
}
