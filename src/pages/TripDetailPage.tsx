import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { COPY } from '@/app/copy';
import {
  EVENT_LABELS,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  formatSpeedKmh,
  formatTime,
  QUALITY_LABELS,
  TRANSPORT_MODE_LABELS,
} from '@/app/format';
import { LazyTrackMap } from '@/components/map/LazyTrackMap';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Notice } from '@/components/ui/Notice';
import { StatusPill } from '@/components/ui/StatusPill';
import { segmentsFromPoints } from '@/domain/geo/segments';
import { incompleteReasons, type IncompleteReason } from '@/domain/trip/incompleteReasons';
import { useTripDetail } from '@/hooks/useTrips';

const REASON_COPY: Readonly<Record<IncompleteReason, string>> = {
  HIDDEN: COPY.hiddenGap,
  GPS_GAP: COPY.gpsGap,
  INTERRUPTED: COPY.interrupted,
  STORAGE: COPY.storageError,
  NO_START_FIX: COPY.noStartFix,
  NO_END_FIX: COPY.noEndFix,
  OTHER: COPY.incompleteOther,
};

export function TripDetailPage() {
  const { id } = useParams();
  const detail = useTripDetail(id);
  const segments = useMemo(
    () => (detail.status === 'ready' ? segmentsFromPoints(detail.data.points) : []),
    [detail],
  );

  if (detail.status === 'loading') {
    return <p className="p-4 text-sm text-slate-600">Đang tải hành trình…</p>;
  }
  if (detail.status !== 'ready') {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <EmptyState
          title="Không tìm thấy hành trình"
          description="Hành trình có thể đã bị xóa khỏi thiết bị này."
          action={
            <Link to="/history" className={buttonClass('secondary')}>
              Về lịch sử
            </Link>
          }
        />
      </div>
    );
  }

  const { trip, points, events } = detail.data;
  const accepted = points.filter((p) => p.accepted).length;
  const start =
    trip.startLat !== null && trip.startLng !== null
      ? { lat: trip.startLat, lng: trip.startLng }
      : null;
  const end =
    trip.endLat !== null && trip.endLng !== null ? { lat: trip.endLat, lng: trip.endLng } : null;
  // Until End, the stored summary is a placeholder: never present it as measured (review I5).
  const finished = trip.status === 'COMPLETED';
  const reasons = finished ? incompleteReasons(trip, events) : [];
  const value = (formatted: string): string => (finished ? formatted : '—');

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">{trip.name}</h1>
        <p className="text-sm text-slate-600">
          {formatDateTime(trip.startedAt)} · {TRANSPORT_MODE_LABELS[trip.transportMode]}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {!finished ? (
            <StatusPill tone="info" label="Đang ghi / chưa hoàn tất" testId="trip-in-progress" />
          ) : trip.isIncomplete ? (
            <StatusPill tone="warn" label="Dữ liệu chưa đầy đủ" testId="trip-incomplete" />
          ) : (
            <StatusPill tone="ok" label="Không phát hiện gián đoạn" />
          )}
          {finished && trip.qualityLabel !== null && (
            <StatusPill
              tone={
                trip.qualityLabel === 'GOOD' ? 'ok' : trip.qualityLabel === 'FAIR' ? 'info' : 'warn'
              }
              label={`Chất lượng GPS: ${QUALITY_LABELS[trip.qualityLabel]} · độ phủ ${formatPercent(trip.coveragePct)}`}
              testId="detail-quality"
            />
          )}
        </div>
      </div>

      {!finished && (
        <Notice
          tone="info"
          action={
            <Link to="/tracking" className={buttonClass('secondary')}>
              Mở màn hình đang đo
            </Link>
          }
        >
          {COPY.tripInProgress}
        </Notice>
      )}
      {reasons.length > 0 && (
        <Notice tone="warn" title="Dữ liệu chưa đầy đủ" testId="incomplete-reasons">
          <ul className="list-disc space-y-1 pl-5">
            {reasons.map((r) => (
              <li key={r} data-reason={r}>
                {REASON_COPY[r]}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <LazyTrackMap
        segments={segments}
        startPoint={start}
        endPoint={end}
        fitToTrack
        className="h-72 sm:h-96"
        ariaLabel="Bản đồ hành trình đã ghi"
      />
      <p className="text-sm text-slate-600">{COPY.measuredDistanceNote}</p>

      <section aria-label="Số liệu hành trình" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MetricCard
          label="Quãng đường GPS đo được"
          value={value(formatDistance(trip.distanceMeasuredM))}
          testId="detail-distance"
        />
        <MetricCard
          label="Tổng thời gian"
          value={value(formatDuration(trip.elapsedMs))}
          testId="detail-elapsed"
        />
        <MetricCard
          label="TB toàn chuyến"
          value={value(formatSpeedKmh(trip.avgElapsedKmh))}
          hint="(dựa trên GPS đo được)"
        />
        <MetricCard label="Số đoạn GPS" value={String(segments.length)} testId="detail-segments" />
        <MetricCard label="Mẫu GPS hợp lệ / nhận" value={`${accepted} / ${points.length}`} />
        <MetricCard
          label="Thời gian di chuyển"
          value={value(formatDuration(trip.movingMs))}
          testId="detail-moving"
        />
        <MetricCard label="Dừng" value={value(formatDuration(trip.stoppedMs))} />
        <MetricCard
          label="Không xác định"
          value={value(formatDuration(trip.unknownMs))}
          hint="thiếu GPS hoặc chưa đủ bằng chứng"
        />
        <MetricCard
          label="Tạm dừng"
          value={value(formatDuration(trip.pausedMs))}
          testId="detail-paused"
        />
        <MetricCard
          label="Độ phủ GPS"
          value={value(formatPercent(trip.coveragePct))}
          testId="detail-coverage"
        />
        <MetricCard label="TB khi di chuyển" value={value(formatSpeedKmh(trip.avgMovingKmh))} />
        <MetricCard label="Tốc độ cao nhất" value={value(formatSpeedKmh(trip.maxSpeedKmh))} />
        <MetricCard
          label="Tốc độ thấp nhất"
          value={value(formatSpeedKmh(trip.minSpeedKmh))}
          hint="0 chỉ khi đã xác nhận dừng"
        />
      </section>

      <section aria-labelledby="trip-events" className="space-y-2">
        <h2 id="trip-events" className="text-base font-semibold text-slate-900">
          Sự kiện
        </h2>
        <ol
          className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200"
          data-testid="trip-events"
        >
          {events.map((e) => (
            <li
              key={e.id}
              className="flex justify-between gap-3 px-3 py-2 text-sm"
              data-event-type={e.type}
            >
              <span>{EVENT_LABELS[e.type]}</span>
              <span className="tabular-nums text-slate-600">{formatTime(e.timestamp)}</span>
            </li>
          ))}
        </ol>
      </section>

      <Link to="/history" className={buttonClass('secondary')}>
        Về lịch sử
      </Link>
    </div>
  );
}
