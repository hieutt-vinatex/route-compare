/**
 * Read hooks over the TripRepository port (components never touch storage directly).
 * useLiveQuery re-runs the repository call whenever the IndexedDB rows it read change
 * (new trip, checkpoint, End in another tab…).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import type { GpsPoint, Trip, TripEvent } from '@/domain/models/types';
import { useServices } from './useServices';

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'ready'; readonly data: T };

type Loaded<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(work: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function useTripList(): LoadState<Trip[]> {
  const { repository } = useServices();
  const result = useLiveQuery(() => settle(repository.listTrips()), [repository]);
  if (result === undefined) return { status: 'loading' };
  if (!result.ok) return { status: 'error', message: result.message };
  return { status: 'ready', data: result.value };
}

export interface TripDetailData {
  readonly trip: Trip;
  readonly points: GpsPoint[];
  readonly events: TripEvent[];
}

export function useTripDetail(id: string | undefined): LoadState<TripDetailData> {
  const { repository } = useServices();
  const result = useLiveQuery(
    () =>
      id === undefined
        ? Promise.resolve(null)
        : settle(
            Promise.all([
              repository.getTrip(id),
              repository.listPoints(id),
              repository.listEvents(id),
            ]),
          ),
    [id, repository],
  );
  if (id === undefined || result === null) return { status: 'not-found' };
  if (result === undefined) return { status: 'loading' };
  if (!result.ok) return { status: 'error', message: result.message };
  const [trip, points, events] = result.value;
  if (trip === undefined) return { status: 'not-found' };
  return { status: 'ready', data: { trip, points, events } };
}
