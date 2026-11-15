/**
 * Group trips that run the same way (RT-401, docs/05 §9). Pure.
 *
 * Two trips belong together when both endpoints are within `routeGroupRadiusM` AND the transport
 * mode matches. B→A is a DIFFERENT group, never the same one reversed.
 *
 * Same endpoints do NOT mean the same road: RouteTrack says "same origin/destination", never
 * "same route". Route variants stay manual in the MVP (docs/05 §9).
 */
import { haversineM } from '../geo/haversine';
import type { GpsConfig } from '../models/gpsConfig';
import type { LatLng, Trip } from '../models/types';

/** A trip can only be grouped when both of its endpoints were actually measured. */
export interface RoutedTrip {
  readonly trip: Trip;
  readonly start: LatLng;
  readonly end: LatLng;
}

export function routedTripOf(trip: Trip): RoutedTrip | null {
  const { startLat, startLng, endLat, endLng } = trip;
  if (startLat === null || startLng === null || endLat === null || endLng === null) return null;
  return {
    trip,
    start: { lat: startLat, lng: startLng },
    end: { lat: endLat, lng: endLng },
  };
}

export function sameRoute(a: RoutedTrip, b: RoutedTrip, config: GpsConfig): boolean {
  if (a.trip.transportMode !== b.trip.transportMode) return false;
  const r = config.routeGroupRadiusM;
  return haversineM(a.start, b.start) <= r && haversineM(a.end, b.end) <= r;
}

export interface RouteGroup {
  /** Trips sharing origin, destination and mode, newest first. */
  readonly trips: readonly Trip[];
  readonly start: LatLng;
  readonly end: LatLng;
}

/**
 * Greedy single-link grouping against each group's first (newest) member, so membership does not
 * drift across an arbitrarily long chain of near-misses.
 */
export function groupTrips(trips: readonly Trip[], config: GpsConfig): RouteGroup[] {
  const routed = trips
    .filter((t) => t.status === 'COMPLETED')
    .map(routedTripOf)
    .filter((r): r is RoutedTrip => r !== null)
    .sort((a, b) => b.trip.startedAt - a.trip.startedAt);

  const groups: { anchor: RoutedTrip; trips: Trip[] }[] = [];
  for (const candidate of routed) {
    const group = groups.find((g) => sameRoute(g.anchor, candidate, config));
    if (group === undefined) groups.push({ anchor: candidate, trips: [candidate.trip] });
    else group.trips.push(candidate.trip);
  }
  return groups.map((g) => ({ trips: g.trips, start: g.anchor.start, end: g.anchor.end }));
}
