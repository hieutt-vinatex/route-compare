import type { LatLng } from '../models/types';

/** Mean Earth radius used by docs/05 §4. */
export const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in meters (docs/05-GPS-ALGORITHMS.md §4). */
export function haversineM(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  // Clamp against floating-point drift so sqrt never sees a negative number.
  const hc = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(hc), Math.sqrt(1 - hc));
}

/**
 * Point reached from `origin` after `distanceM` along initial bearing `bearingDeg`
 * on a sphere of radius EARTH_RADIUS_M. Used to build synthetic replay fixtures.
 */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  const lng = ((toDeg(lambda2) + 540) % 360) - 180;
  return { lat: toDeg(phi2), lng };
}
