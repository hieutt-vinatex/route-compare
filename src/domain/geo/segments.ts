import type { GpsPoint, LatLng } from '../models/types';

/**
 * Group accepted points into polylines, one per GPS segment, in sourceSeq order.
 * Rejected points are excluded. Segments are never joined (docs/05 §4, FR-07).
 */
export function segmentsFromPoints(points: readonly GpsPoint[]): LatLng[][] {
  const accepted = points
    .filter((p) => p.accepted && p.segmentId !== null)
    .sort((a, b) => a.sourceSeq - b.sourceSeq);
  const out: LatLng[][] = [];
  let currentSegment: number | null = null;
  let current: LatLng[] = [];
  for (const p of accepted) {
    if (p.segmentId !== currentSegment) {
      current = [];
      out.push(current);
      currentSegment = p.segmentId;
    }
    current.push({ lat: p.latitude, lng: p.longitude });
  }
  return out;
}
