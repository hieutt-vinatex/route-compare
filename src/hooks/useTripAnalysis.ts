/**
 * Trip Detail analysis (FR-10): the persisted raw points + events are replayed by the same pure
 * engine as End (docs/05), so map, counts, stats and chart share one source (M2 minor M10).
 * Only finished trips are analysed; a trip still recording has no final numbers yet.
 */
import { useMemo } from 'react';
import { analyzeTrip, type TripMetrics } from '@/domain/analytics/analyzeTrip';
import { importConfig } from '@/domain/import/importedTrip';
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
  const importedFrom = detail?.trip.importedFrom ?? null;
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
      // An imported file sets its own sampling rate; judging it by the live watchPosition rules
      // would report every step as a gap and the whole track as 0 m.
      config:
        importedFrom === null
          ? config
          : importConfig(
              points.map((p) => ({ timestamp: p.sourceTimestamp, accuracyM: p.accuracyM })),
              config,
            ),
    });
  }, [status, startedAt, endedAt, transportMode, importedFrom, points, events, config]);
}
