import { lazy, Suspense } from 'react';
import type { TrackMapProps } from './trackMapTypes';

const TrackMap = lazy(() => import('./TrackMap'));

/** Leaflet is loaded on demand so the app shell stays small. */
export function LazyTrackMap(props: TrackMapProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`flex items-center justify-center rounded-2xl bg-slate-200 text-sm text-slate-600 ${props.className ?? ''}`}
        >
          Đang tải bản đồ…
        </div>
      }
    >
      <TrackMap {...props} />
    </Suspense>
  );
}
