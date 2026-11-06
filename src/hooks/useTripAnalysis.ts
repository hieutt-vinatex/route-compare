/**
 * Trip Detail analysis (FR-10): the persisted raw points + events are replayed by the same pure
 * engine as End (docs/05), so map, counts, stats and chart share one source (M2 minor M10).
 * Only finished trips are analysed; a trip still recording has no final numbers yet.
 */
import { useMemo } from 'react';
import { analyzeTrip, type TripMetrics } from '@/domain/analytics/analyzeTrip';
import type { TripDetailData } from './useTrips';
import { useServices } from './useServices';

export function useTripAnalysis(detail: TripDetailData | null): TripMetrics | null {
  const { config } = useServices();
  // The detail wrapper is rebuilt every render; its row and arrays are stable references.
  const trip = detail?.trip;
  const points = detail?.points;
  const events = detail?.events;
  return useMemo(() => {
    if (trip?.status !== 'COMPLETED' || points === undefined || events === undefined) return null;
    return analyzeTrip({
      trip,
      points,
      events,
      endedAt: trip.endedAt ?? trip.startedAt,
      config,
    });
  }, [trip, points, events, config]);
}
