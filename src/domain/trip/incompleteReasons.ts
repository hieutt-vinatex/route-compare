import type { Trip, TripEvent } from '../models/types';

/** Why a trip is marked incomplete — derived only from persisted data (review I5). */
export type IncompleteReason =
  'HIDDEN' | 'GPS_GAP' | 'INTERRUPTED' | 'STORAGE' | 'NO_START_FIX' | 'NO_END_FIX' | 'OTHER';

const FATAL_CODES = new Set(['PERMISSION_DENIED', 'UNSUPPORTED', 'INSECURE_CONTEXT']);

export function incompleteReasons(
  trip: Pick<Trip, 'isIncomplete' | 'startLat' | 'endLat'>,
  events: readonly TripEvent[],
): IncompleteReason[] {
  if (!trip.isIncomplete) return [];
  const types = new Set(events.map((e) => e.type));
  const reasons: IncompleteReason[] = [];
  if (types.has('PAGE_HIDDEN')) reasons.push('HIDDEN');
  if (types.has('GPS_GAP_BEGIN') || types.has('GPS_GAP_END')) reasons.push('GPS_GAP');
  const fatalError = events.some(
    (e) => e.type === 'GPS_ERROR' && FATAL_CODES.has(String(e.metadata?.code)),
  );
  if (fatalError || types.has('RECOVERY')) reasons.push('INTERRUPTED');
  if (types.has('STORAGE_ERROR')) reasons.push('STORAGE');
  if (trip.startLat === null) reasons.push('NO_START_FIX');
  if (trip.endLat === null) reasons.push('NO_END_FIX');
  return reasons.length > 0 ? reasons : ['OTHER'];
}
