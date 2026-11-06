import { destinationPoint } from '@/domain/geo/haversine';
import type { ReplayPoint } from './ReplayGeolocationAdapter';

/**
 * Deterministic synthetic walking route (~1.4 m/s, 1 sample/s) around a public landmark area
 * in Hà Nội. Synthetic data only — not a recording of any person.
 */
export function buildDemoRoute(count = 900): ReplayPoint[] {
  let seed = 42;
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const points: ReplayPoint[] = [];
  let position = { lat: 21.0287, lng: 105.8524 };
  let bearing = 20;
  for (let i = 0; i < count; i += 1) {
    if (i % 60 === 0) bearing = (bearing + 70 + random() * 40) % 360;
    position = destinationPoint(position, bearing, 1.4);
    const jitter = destinationPoint(position, random() * 360, random() * 3);
    points.push({ lat: jitter.lat, lng: jitter.lng, accuracyM: 5 + random() * 10 });
  }
  return points;
}
