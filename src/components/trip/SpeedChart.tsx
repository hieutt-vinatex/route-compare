/**
 * Speed over time (RT-303, docs/06 §4). Loaded lazily (ADR-09): Chart.js is only fetched when a
 * finished trip's detail is opened. UNKNOWN / PAUSED time is shaded by a small inline plugin; missing
 * speeds are line breaks, never 0 (BR-07). Only the Chart.js parts used here are registered.
 */
import {
  Chart as ChartJS,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { SpeedSeries } from '@/domain/analytics/speedSeries';
import { formatChartMinutes } from './chartTime';
import { bandsPlugin, LINE_COLOR } from './speedChartBands';

ChartJS.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

const speedFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export default function SpeedChart({
  series,
  summary,
}: {
  readonly series: SpeedSeries;
  readonly summary: string;
}) {
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: prefersReducedMotion() ? false : { duration: 300 },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        title: { display: true, text: 'Thời gian từ lúc bắt đầu (phút:giây)' },
        ticks: { callback: (v) => formatChartMinutes(Number(v)), maxTicksLimit: 7 },
      },
      y: {
        type: 'linear',
        beginAtZero: true,
        title: { display: true, text: 'km/h' },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => `Sau ${formatChartMinutes(items[0]?.parsed.x ?? 0)}`,
          label: (item) => `${speedFormat.format(item.parsed.y ?? 0)} km/h`,
        },
      },
      rtBands: { bands: series.bands },
    },
  };
  const kinds = new Set(series.bands.map((b) => b.kind));

  return (
    <figure className="space-y-2">
      <div className="h-56 sm:h-64">
        <Line
          role="img"
          aria-label={summary}
          data={{
            datasets: [
              {
                label: 'Tốc độ (km/h)',
                data: series.points.map((p) => ({ x: p.tMin, y: p.kmh })),
                borderColor: LINE_COLOR,
                backgroundColor: LINE_COLOR,
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 6,
                spanGaps: false,
                tension: 0,
              },
            ],
          }}
          options={options}
          plugins={[bandsPlugin]}
        />
      </div>
      <figcaption
        className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600"
        data-testid="speed-chart-legend"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-5 bg-teal-700" />
          Tốc độ (km/h)
        </span>
        {kinds.has('UNKNOWN') && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-slate-500/25" />
            Không xác định (không vẽ tốc độ)
          </span>
        )}
        {kinds.has('PAUSED') && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm bg-sky-500/20" />
            Tạm dừng
          </span>
        )}
      </figcaption>
    </figure>
  );
}
