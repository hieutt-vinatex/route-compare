import { formatDistance, formatDuration, formatPercent, formatSpeedKmh } from '@/app/format';
import { MetricCard } from '@/components/ui/MetricCard';
import type { TripMetrics } from '@/domain/analytics/analyzeTrip';

export interface TripCounts {
  readonly segments: number;
  readonly accepted: number;
  readonly raw: number;
}

const total = (intervals: TripMetrics['unmeasured']): number =>
  intervals.reduce((sum, i) => sum + (i.to - i.from), 0);

/**
 * Trip Detail statistics (docs/06 §4, RT-302). `metrics` is null until the trip is finished: the
 * stored live summary is never presented as measured (review I5), so values show “—”.
 */
export function TripStats({
  metrics,
  counts,
}: {
  readonly metrics: TripMetrics | null;
  readonly counts: TripCounts;
}) {
  const m = metrics;
  return (
    <section aria-label="Số liệu hành trình" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <MetricCard
        label="Quãng đường GPS đo được"
        value={m === null ? '—' : formatDistance(m.distanceMeasuredM)}
        testId="detail-distance"
      />
      <MetricCard
        label="Tổng thời gian"
        value={m === null ? '—' : formatDuration(m.elapsedMs)}
        testId="detail-elapsed"
      />
      <MetricCard
        label="TB toàn chuyến"
        value={formatSpeedKmh(m?.avgElapsedKmh)}
        hint="(dựa trên GPS đo được)"
      />
      <MetricCard label="Số đoạn GPS" value={String(counts.segments)} testId="detail-segments" />
      <MetricCard label="Mẫu GPS hợp lệ / nhận" value={`${counts.accepted} / ${counts.raw}`} />
      <MetricCard
        label="Thời gian di chuyển"
        value={formatDuration(m?.movingMs)}
        testId="detail-moving"
      />
      <MetricCard label="Dừng" value={formatDuration(m?.stoppedMs)} />
      <MetricCard
        label="Không xác định"
        value={formatDuration(m?.unknownMs)}
        hint="thiếu GPS hoặc chưa đủ bằng chứng"
      />
      <MetricCard
        label="Không có GPS"
        value={m === null ? '—' : formatDuration(total(m.unmeasured))}
        hint="tổng các khoảng mất tín hiệu"
        testId="detail-gps-gap"
      />
      <MetricCard
        label="Tạm dừng"
        value={m === null ? '—' : formatDuration(m.pausedMs)}
        testId="detail-paused"
      />
      <MetricCard
        label="Độ phủ GPS"
        value={formatPercent(m?.coveragePct)}
        testId="detail-coverage"
      />
      <MetricCard label="TB khi di chuyển" value={formatSpeedKmh(m?.avgMovingKmh)} />
      <MetricCard
        label="Tốc độ cao nhất"
        value={formatSpeedKmh(m?.maxSpeedKmh)}
        testId="detail-max-speed"
      />
      <MetricCard
        label="Tốc độ thấp nhất"
        value={formatSpeedKmh(m?.minSpeedKmh)}
        hint="0 chỉ khi đã xác nhận dừng"
        testId="detail-min-speed"
      />
    </section>
  );
}
