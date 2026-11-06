import { useCallback, useEffect, useState } from 'react';
import type { Trip } from '@/domain/models/types';
import { useServices } from './useServices';
import { useTracking } from './useTracking';

/** An unfinished trip left by a reload/closed tab (FR-12), while this tab is idle. */
export interface RecoverableTrip {
  /** Unfinished trip left by a reload/crash, or null. */
  readonly trip: Trip | null;
  /** Look again (after the user resolved it). */
  readonly refresh: () => void;
}

export function useRecoverableTrip(): RecoverableTrip {
  const { tracker, lock } = useServices();
  const { status } = useTracking();
  const [found, setFound] = useState<Trip | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (status !== 'IDLE') return;
    let cancelled = false;
    const look = (): void => {
      void tracker.findRecoverable().then((trip) => {
        if (!cancelled) setFound(trip);
      });
    };
    look();
    const unsubscribe = lock.onChange(look);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tracker, lock, status, version]);

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  return { trip: status === 'IDLE' ? found : null, refresh };
}
