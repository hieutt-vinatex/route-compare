/** Helpers for reload recovery (FR-12, UC-08). Pure. */
import type { GpsPoint, Trip, TripEvent } from '../models/types';

/**
 * Last moment anything was persisted for the trip: checkpoint, raw sample or event (R1).
 * An unfinished trip “ended after a reload” ends here, not when the app was reopened.
 */
export function lastActivityAt(
  trip: Pick<Trip, 'startedAt' | 'updatedAt'>,
  points: readonly GpsPoint[],
  events: readonly TripEvent[],
): number {
  let last = Math.max(trip.startedAt, trip.updatedAt);
  for (const p of points) if (p.recordedAt > last) last = p.recordedAt;
  for (const e of events) if (e.timestamp > last) last = e.timestamp;
  return last;
}

/** Highest number used by the shared per-trip sequence (points + events). */
export function maxSequence(points: readonly GpsPoint[], events: readonly TripEvent[]): number {
  let max = 0;
  for (const p of points) if (p.sourceSeq > max) max = p.sourceSeq;
  for (const e of events) if (e.seq > max) max = e.seq;
  return max;
}
