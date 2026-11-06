import 'leaflet/dist/leaflet.css';
import { latLngBounds, type LatLngExpression } from 'leaflet';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { COPY } from '@/app/copy';
import type { LatLng } from '@/domain/models/types';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FOLLOW_ZOOM,
  LEAFLET_PREFIX,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL,
} from './tileConfig';
import type { MapPosition, TrackMapProps } from './trackMapTypes';

const SEGMENT_COLOR = '#0f766e';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Leaflet only reads these arrays; the cast avoids copying large tracks on every render. */
function asPositions(segment: readonly LatLng[]): LatLngExpression[] {
  return segment as LatLngExpression[];
}

const SegmentLayer = memo(function SegmentLayer({ segment }: { segment: readonly LatLng[] }) {
  const first = segment[0];
  const last = segment.at(-1);
  return (
    <>
      <Polyline
        positions={asPositions(segment)}
        className="rt-segment"
        pathOptions={{ color: SEGMENT_COLOR, weight: 5, opacity: 0.9 }}
      />
      {/* Hollow endpoints make the unmeasured gap between segments visible. */}
      {first !== undefined && (
        <CircleMarker
          center={first}
          radius={4}
          className="rt-segment-end"
          pathOptions={{
            color: SEGMENT_COLOR,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 2,
          }}
        />
      )}
      {last !== undefined && last !== first && (
        <CircleMarker
          center={last}
          radius={4}
          className="rt-segment-end"
          pathOptions={{
            color: SEGMENT_COLOR,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 2,
          }}
        />
      )}
    </>
  );
});

function FollowPosition({
  position,
  follow,
  onUserMovedMap,
}: {
  position: MapPosition | null;
  follow: boolean;
  onUserMovedMap: (() => void) | undefined;
}) {
  const map = useMap();
  const centered = useRef(false);
  useMapEvents({
    dragstart: () => {
      onUserMovedMap?.();
    },
  });
  useEffect(() => {
    if (position === null) return;
    const target: LatLngExpression = [position.lat, position.lng];
    if (!centered.current) {
      map.setView(target, Math.max(map.getZoom(), FOLLOW_ZOOM), { animate: false });
      centered.current = true;
      return;
    }
    // panTo keeps the user's zoom level; we never auto-zoom while following.
    if (follow) map.panTo(target, { animate: !prefersReducedMotion() });
  }, [map, position, follow]);
  return null;
}

function FitToTrack({ segments }: { segments: readonly (readonly LatLng[])[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const all = segments.flat();
    if (all.length === 0) return;
    done.current = true;
    if (all.length === 1 && all[0] !== undefined) {
      map.setView(all[0], FOLLOW_ZOOM, { animate: false });
      return;
    }
    map.fitBounds(latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [24, 24],
      animate: false,
    });
  }, [map, segments]);
  return null;
}

export default function TrackMap({
  segments,
  trackVersion,
  current = null,
  startPoint = null,
  endPoint = null,
  showAccuracy = true,
  follow = false,
  onUserMovedMap,
  fitToTrack = false,
  className = '',
  ariaLabel,
}: TrackMapProps) {
  const [tileError, setTileError] = useState(false);
  const tileHandlers = useMemo(
    () => ({
      tileerror: () => {
        setTileError(true);
      },
      tileload: () => {
        setTileError(false);
      },
    }),
    [],
  );

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl bg-slate-200 ${className}`}
      role="region"
      aria-label={ariaLabel}
      data-track-version={trackVersion}
      data-segment-count={segments.length}
    >
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="h-full w-full"
        scrollWheelZoom
        attributionControl={false}
      >
        <AttributionControl position="bottomright" prefix={LEAFLET_PREFIX} />
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          maxZoom={TILE_MAX_ZOOM}
          eventHandlers={tileHandlers}
        />
        {segments.map((segment, index) => (
          <SegmentLayer key={index} segment={segment} />
        ))}
        {startPoint !== null && (
          <CircleMarker
            center={startPoint}
            radius={8}
            className="rt-start"
            pathOptions={{
              color: '#065f46',
              fillColor: '#10b981',
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Tooltip>Điểm bắt đầu</Tooltip>
          </CircleMarker>
        )}
        {endPoint !== null && (
          <CircleMarker
            center={endPoint}
            radius={8}
            className="rt-end"
            pathOptions={{
              color: '#7f1d1d',
              fillColor: '#ef4444',
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Tooltip>Điểm kết thúc</Tooltip>
          </CircleMarker>
        )}
        {current !== null && showAccuracy && current.accuracyM !== null && (
          <Circle
            center={current}
            radius={current.accuracyM}
            className="rt-accuracy"
            pathOptions={{
              color: '#2563eb',
              weight: 1,
              fillOpacity: 0.12,
            }}
          />
        )}
        {current !== null && (
          <CircleMarker
            center={current}
            radius={8}
            className="rt-current"
            pathOptions={{
              color: '#1d4ed8',
              fillColor: current.accepted === false ? '#93c5fd' : '#3b82f6',
              fillOpacity: 1,
              weight: 3,
              dashArray: current.accepted === false ? '3 3' : undefined,
            }}
          >
            <Tooltip>
              {current.accepted === false
                ? 'Vị trí hiện tại (độ chính xác thấp)'
                : 'Vị trí hiện tại'}
            </Tooltip>
          </CircleMarker>
        )}
        {fitToTrack ? (
          <FitToTrack segments={segments} />
        ) : (
          <FollowPosition position={current} follow={follow} onUserMovedMap={onUserMovedMap} />
        )}
      </MapContainer>
      {tileError && (
        <p className="pointer-events-none absolute inset-x-2 top-2 z-[1000] rounded-lg bg-white/95 p-2 text-sm text-slate-800 shadow">
          {COPY.offlineMap}
        </p>
      )}
    </div>
  );
}
