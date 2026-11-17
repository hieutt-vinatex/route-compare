/**
 * Load the selected trips' raw data and analyse each one (RT-402). The comparison always runs on
 * recomputed metrics, never on the stored summary, so every row comes from the same engine.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { analyzeTrip } from '@/domain/analytics/analyzeTrip';
import type { ComparedTrip } from '@/domain/compare/compare';
import { importConfig } from '@/domain/import/importedTrip';
import type { GpsConfig } from '@/domain/models/gpsConfig';
import type { Trip } from '@/domain/models/types';
import type { TripRepository } from '@/domain/ports';
import { useServices } from './useServices';
import { settle, type LoadState } from './useTrips';

async function analyseOne(
  repository: TripRepository,
  trip: Trip,
  config: GpsConfig,
): Promise<ComparedTrip> {
  const [points, events] = await Promise.all([
    repository.listPoints(trip.id),
    repository.listEvents(trip.id),
  ]);
  return {
    trip,
    metrics: analyzeTrip({
      trip,
      points,
      events,
      endedAt: trip.endedAt ?? trip.startedAt,
      // An imported file sets its own sampling rate (see useTripAnalysis).
      config:
        trip.importedFrom === 'GPX'
          ? importConfig(
              points.map((p) => ({ timestamp: p.sourceTimestamp, accuracyM: p.accuracyM })),
              config,
            )
          : config,
    }),
  };
}

export function useComparedTrips(trips: readonly Trip[]): LoadState<readonly ComparedTrip[]> {
  const { repository, config } = useServices();
  const key = JSON.stringify(trips);
  const result = useLiveQuery(
    () => settle(Promise.all(trips.map((trip) => analyseOne(repository, trip, config)))),
    // Include metadata edits (especially variant labels), not object identity or only IDs.
    [key, repository, config],
  );
  if (result === undefined) return { status: 'loading' };
  if (!result.ok) return { status: 'error', message: result.message };
  // useLiveQuery keeps serving the PREVIOUS result while it re-runs for a new selection. Reporting
  // it as ready would show a comparison table whose rows are not the trips that are ticked.
  if (JSON.stringify(result.value.map((t) => t.trip)) !== key) return { status: 'loading' };
  return { status: 'ready', data: result.value };
}
