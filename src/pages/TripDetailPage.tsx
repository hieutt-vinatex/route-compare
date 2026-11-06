import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { COPY, lowGpsCopy } from '@/app/copy';
import {
  EVENT_LABELS,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatSpeedKmh,
  formatTime,
  QUALITY_LABELS,
  TRANSPORT_MODE_LABELS,
} from '@/app/format';
import { LazyTrackMap } from '@/components/map/LazyTrackMap';
import { FormulaNotes } from '@/components/trip/FormulaNotes';
import { LazySpeedChart } from '@/components/trip/LazySpeedChart';
import { qualityTone } from '@/components/trip/quality';
import { TripActions } from '@/components/trip/TripActions';
import { TripStats, type TripCounts } from '@/components/trip/TripStats';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { StatusPill } from '@/components/ui/StatusPill';
import { buildSpeedSeries } from '@/domain/analytics/speedSeries';
import { segmentsFromPoints } from '@/domain/geo/segments';
import { incompleteReasons, type IncompleteReason } from '@/domain/trip/incompleteReasons';
import { useServices } from '@/hooks/useServices';
import { useTripAnalysis } from '@/hooks/useTripAnalysis';
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
  const { config } = useServices();
  const detail = useTripDetail(id);
  const data = detail.status === 'ready' ? detail.data : null;
  // A finished trip is replayed from its raw data: map, counts, stats share one source (M10).
  const metrics = useTripAnalysis(data);
  const points = data?.points;
  const liveSegments = useMemo(
    () => (metrics === null && points !== undefined ? segmentsFromPoints(points) : []),
    [metrics, points],
  );
  const startedAt = data?.trip.startedAt;
  const series = useMemo(
    () =>
      metrics === null || startedAt === undefined ? null : buildSpeedSeries(metrics, startedAt),
    [metrics, startedAt],
  );

  if (detail.status === 'loading') {
    return <p className="p-4 text-sm text-slate-600">Đang tải hành trình…</p>;
  }
  if (data === null) {
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

  const { trip, events } = data;
  const finished = metrics !== null;
  const reasons = finished ? incompleteReasons(trip, events, metrics) : [];
  const segments = metrics?.segments ?? liveSegments;
  const counts: TripCounts =
    metrics === null
      ? {
          segments: liveSegments.length,
          accepted: data.points.filter((p) => p.accepted).length,
          raw: data.points.length,
        }
      : {
          segments: metrics.segments.length,
          accepted: metrics.acceptedCount,
          raw: metrics.rawCount,
        };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold break-words text-slate-900">{trip.name}</h1>
        <p className="text-sm text-slate-600">
          {formatDateTime(trip.startedAt)} · {TRANSPORT_MODE_LABELS[trip.transportMode]}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {!finished ? (
            <StatusPill tone="info" label="Đang ghi / chưa hoàn tất" testId="trip-in-progress" />
          ) : metrics.isIncomplete ? (
            <StatusPill tone="warn" label="Dữ liệu chưa đầy đủ" testId="trip-incomplete" />
          ) : (
            <StatusPill tone="ok" label="Không phát hiện gián đoạn" />
          )}
          {finished && (
            <StatusPill
              tone={qualityTone(metrics.qualityLabel)}
              label={`Chất lượng GPS: ${QUALITY_LABELS[metrics.qualityLabel]} · độ phủ ${formatPercent(metrics.coveragePct)}`}
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
      {finished && metrics.qualityLabel === 'LOW' && (
        <Notice tone="warn" testId="low-quality">
          {lowGpsCopy(metrics.unknownMs)}
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
        startPoint={metrics?.start ?? null}
        endPoint={metrics?.end ?? null}
        fitToTrack
        className="h-72 sm:h-96"
        ariaLabel="Bản đồ hành trình đã ghi"
      />
      <p className="text-sm text-slate-600">{COPY.measuredDistanceNote}</p>

      <TripStats metrics={metrics} counts={counts} />
      {finished && series !== null && (
        <section aria-labelledby="speed-chart" className="space-y-2">
          <h2 id="speed-chart" className="text-base font-semibold text-slate-900">
            Tốc độ theo thời gian
          </h2>
          <LazySpeedChart
            series={series}
            summary={`Tốc độ theo thời gian. Cao nhất ${formatSpeedKmh(metrics.maxSpeedKmh)}; ${formatDuration(metrics.unknownMs)} không xác định; ${formatDuration(metrics.pausedMs)} tạm dừng.`}
          />
        </section>
      )}
      {finished && <FormulaNotes config={config} />}

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

      {finished && <TripActions key={trip.id} trip={trip} />}

      <Link to="/history" className={buttonClass('secondary')}>
        Về lịch sử
      </Link>
    </div>
  );
}
