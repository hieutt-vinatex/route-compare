import { haversineM } from '../geo/haversine';
import type { LatLng } from '../models/types';

/** Remove endpoint circles everywhere they are visited, splitting every surviving run. */
export function outsideEndpointAreas<T extends LatLng>(
  samples: readonly T[],
  radiusM: number,
  extraCenters: readonly LatLng[] = [],
): readonly (readonly T[])[] {
  if (!Number.isFinite(radiusM) || radiusM < 0) {
    throw new RangeError('Bán kính ẩn phải là số hữu hạn từ 0 m trở lên.');
  }
  if (radiusM === 0) return [samples];
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined) {
    throw new RangeError('Không còn điểm GPS để xuất sau khi ẩn đầu/cuối.');
  }
  const centers = [first, last, ...extraCenters];
  const runs: T[][] = [];
  let current: T[] | null = null;
  for (const sample of samples) {
    if (centers.some((center) => haversineM(center, sample) <= radiusM)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [];
      runs.push(current);
    }
    current.push(sample);
  }
  if (runs.length === 0) {
    throw new RangeError('Không còn điểm GPS để xuất sau khi ẩn đầu/cuối.');
  }
  return runs;
}
