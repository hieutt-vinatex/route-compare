/** Speed helpers. Domain speeds are m/s; UI shows km/h. */

export const MPS_TO_KMH = 3.6;

export function mpsToKmh(mps: number): number {
  return mps * MPS_TO_KMH;
}

/** Median of a non-empty list; null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

/**
 * “TB theo toàn chuyến (dựa trên GPS đo được)” — docs/05 §7:
 * avgElapsedKmh = distanceMeasuredM / elapsedSeconds * 3.6.
 * Returns null when nothing has been measured yet or elapsed is not positive,
 * so the UI shows “—” instead of a fabricated 0.
 */
export function avgElapsedKmh(
  distanceMeasuredM: number,
  elapsedMs: number,
  measuredEdgeCount: number,
): number | null {
  if (measuredEdgeCount <= 0 || elapsedMs <= 0) return null;
  return mpsToKmh(distanceMeasuredM / (elapsedMs / 1000));
}
