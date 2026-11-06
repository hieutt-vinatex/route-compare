/**
 * What the repository holds for a trip: raw points + events sharing one per-trip sequence.
 * Stored processing flags are left empty (accepted=false) — analytics must replay the raw data.
 */
import type {
  GpsPoint,
  TransportMode,
  Trip,
  TripEvent,
  TripEventType,
} from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { T0, toSample, type SampleSpec } from './gpsFixtures';

export type Step =
  { readonly sample: SampleSpec } | { readonly event: TripEventType; readonly t: number };

export const samples = (specs: readonly SampleSpec[]): Step[] =>
  specs.map((sample) => ({ sample }));

export function persistedTrip(
  steps: readonly Step[],
  mode: TransportMode = 'MOTORBIKE',
  id = 'trip',
): { trip: Trip; points: GpsPoint[]; events: TripEvent[] } {
  const trip: Trip = createTrip({ id, name: 'x', transportMode: mode, startedAt: T0 });
  const points: GpsPoint[] = [];
  const events: TripEvent[] = [];
  let seq = 0;
  for (const step of steps) {
    seq += 1;
    if ('sample' in step) {
      points.push({
        id: `${id}-p${seq}`,
        tripId: trip.id,
        sourceSeq: seq,
        ...toSample(step.sample),
        segmentId: null,
        accepted: false,
        rejectCode: null,
        derivedSpeedMps: null,
      });
    } else {
      events.push({
        id: `${id}-e${seq}`,
        tripId: trip.id,
        seq,
        timestamp: T0 + step.t,
        type: step.event,
        metadata: null,
      });
    }
  }
  return { trip, points, events };
}
