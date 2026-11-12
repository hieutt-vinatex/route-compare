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
  // Depend on the fields the analysis reads, so a rename (new row object) does not re-run it.
  const points = detail?.points;
  const events = detail?.events;
  const status = detail?.trip.status;
  const startedAt = detail?.trip.startedAt;
  const endedAt = detail?.trip.endedAt ?? null;
  const transportMode = detail?.trip.transportMode;
  return useMemo(() => {
    if (
      status !== 'COMPLETED' ||
      startedAt === undefined ||
      transportMode === undefined ||
      points === undefined ||
      events === undefined
    ) {
      return null;
    }
    return analyzeTrip({
      trip: { startedAt, transportMode },
      points,
      events,
      endedAt: endedAt ?? startedAt,
      config,
    });
  }, [status, startedAt, endedAt, transportMode, points, events, config]);
}
