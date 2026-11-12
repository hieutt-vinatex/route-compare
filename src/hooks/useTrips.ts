/**
 * Read hooks over the TripRepository port (components never touch storage directly).
 * useLiveQuery re-runs the repository call whenever the IndexedDB rows it read change
 * (new trip, checkpoint, End in another tab…).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
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

/**
 * The trip row is live; its points/events are re-read only when the row changes (`status` or
 * `updatedAt`: checkpoint every 15 s, End, rename) — not on every GPS sample of an active trip,
 * which would re-read the whole track each time (NFR-09, M2 minor M16).
 */
export function useTripDetail(id: string | undefined): LoadState<TripDetailData> {
  const { repository } = useServices();
  const row = useLiveQuery(
    () => (id === undefined ? Promise.resolve(null) : settle(repository.getTrip(id))),
    [id, repository],
  );
  const trip = row !== undefined && row !== null && row.ok ? row.value : undefined;
  // A finished trip's points/events never change (a rename only bumps updatedAt).
  const version =
    trip === undefined
      ? null
      : `${trip.id}:${trip.status}:${trip.status === 'COMPLETED' ? '' : String(trip.updatedAt)}`;
  const [track, setTrack] = useState<{
    readonly tripId: string;
    readonly result: Loaded<[GpsPoint[], TripEvent[]]>;
  } | null>(null);

  useEffect(() => {
    if (id === undefined || version === null) return;
    let cancelled = false;
    void settle(Promise.all([repository.listPoints(id), repository.listEvents(id)])).then(
      (result) => {
        if (!cancelled) setTrack({ tripId: id, result });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, version, repository]);

  if (id === undefined || row === null) return { status: 'not-found' };
  if (row === undefined) return { status: 'loading' };
  if (!row.ok) return { status: 'error', message: row.message };
  if (trip === undefined) return { status: 'not-found' };
  // Keep showing the previous track of the same trip while a newer one loads.
  if (track === null || track.tripId !== trip.id) return { status: 'loading' };
  if (!track.result.ok) return { status: 'error', message: track.result.message };
  const [points, events] = track.result.value;
  return { status: 'ready', data: { trip, points, events } };
}
