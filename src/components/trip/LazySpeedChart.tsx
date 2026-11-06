import { lazy, Suspense } from 'react';
import type { SpeedSeries } from '@/domain/analytics/speedSeries';

/** Chart.js is a separate chunk, fetched only when there is something to plot (ADR-09). */
const SpeedChart = lazy(() => import('./SpeedChart'));

export function LazySpeedChart({
  series,
  summary,
}: {
  readonly series: SpeedSeries;
  readonly summary: string;
}) {
  if (!series.hasData) {
    return (
      <p className="rounded-xl bg-white p-3 text-sm text-slate-600 ring-1 ring-slate-200">
        Chưa đủ dữ liệu tốc độ để vẽ biểu đồ.
      </p>
    );
  }
  return (
    <Suspense fallback={<p className="h-56 text-sm text-slate-600 sm:h-64">Đang tải biểu đồ…</p>}>
      <SpeedChart series={series} summary={summary} />
    </Suspense>
  );
}
