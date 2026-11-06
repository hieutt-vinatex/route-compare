import { useSyncExternalStore } from 'react';
import type { TrackingSnapshot } from '@/domain/trip/TrackingController';
import { useServices } from './useServices';

/** Live, throttled snapshot of the active trip (published at most every uiRefreshMs). */
export function useTracking(): TrackingSnapshot {
  const { tracker } = useServices();
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot);
}
