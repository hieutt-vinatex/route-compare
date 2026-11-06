import type { TripMetrics } from '../analytics/analyzeTrip';
import type { Trip, TripEvent } from '../models/types';

/** Why a trip is marked incomplete — derived only from persisted data (review I5). */
export type IncompleteReason =
  'HIDDEN' | 'GPS_GAP' | 'INTERRUPTED' | 'STORAGE' | 'NO_START_FIX' | 'NO_END_FIX' | 'OTHER';

const FATAL_CODES = new Set(['PERMISSION_DENIED', 'UNSUPPORTED', 'INSECURE_CONTEXT']);

/**
 * With `analysis` (the replay of the raw data, Trip Detail) start/end fixes and large gaps come from
 * it — so a gap is named even when no live GPS_GAP event was recorded. A trip is incomplete when
 * either source says so: the stored flag also carries what the GPS data cannot show (storage error,
 * fatal GPS error, recovery — tripFactory.applyMetrics).
 */
export function incompleteReasons(
  trip: Pick<Trip, 'isIncomplete' | 'startLat' | 'endLat'>,
  events: readonly TripEvent[],
  analysis?: Pick<TripMetrics, 'isIncomplete' | 'start' | 'end' | 'largeGapCount'>,
): IncompleteReason[] {
  const isIncomplete = trip.isIncomplete || analysis?.isIncomplete === true;
  if (!isIncomplete) return [];
  const hasStart = analysis === undefined ? trip.startLat !== null : analysis.start !== null;
  const hasEnd = analysis === undefined ? trip.endLat !== null : analysis.end !== null;
  const types = new Set(events.map((e) => e.type));
  const reasons: IncompleteReason[] = [];
  if (types.has('PAGE_HIDDEN')) reasons.push('HIDDEN');
  if (
    types.has('GPS_GAP_BEGIN') ||
    types.has('GPS_GAP_END') ||
    (analysis !== undefined && analysis.largeGapCount > 0)
  ) {
    reasons.push('GPS_GAP');
  }
  const fatalError = events.some(
    (e) => e.type === 'GPS_ERROR' && FATAL_CODES.has(String(e.metadata?.code)),
  );
  if (fatalError || types.has('RECOVERY')) reasons.push('INTERRUPTED');
  if (types.has('STORAGE_ERROR')) reasons.push('STORAGE');
  if (!hasStart) reasons.push('NO_START_FIX');
  if (!hasEnd) reasons.push('NO_END_FIX');
  return reasons.length > 0 ? reasons : ['OTHER'];
}
