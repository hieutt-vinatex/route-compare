import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Line } from 'react-chartjs-2';
import { describe, expect, it, vi } from 'vitest';
import type { SpeedSeries } from '@/domain/analytics/speedSeries';
import { LazySpeedChart } from './LazySpeedChart';
import SpeedChart from './SpeedChart';
import { BANDS_PLUGIN_ID, drawBands } from './speedChartBands';
import { formatChartMinutes } from './chartTime';

type LineProps = ComponentProps<typeof Line>;
const captured: { props: LineProps | null } = { props: null };

// Canvas rendering needs a real browser (covered by Playwright); here we check what Chart.js gets.
vi.mock('react-chartjs-2', () => ({
  Line: (props: LineProps) => {
    captured.props = props;
    return <canvas data-testid="chart-canvas" role={props.role} aria-label={props['aria-label']} />;
  },
}));

const series: SpeedSeries = {
  points: [
    { tMin: 0.1, kmh: 18 },
    { tMin: 0.2, kmh: 20 },
    { tMin: 0.5, kmh: null },
    { tMin: 1.5, kmh: 0 },
    { tMin: 1.6, kmh: 0 },
  ],
  bands: [
    { fromMin: 0.2, toMin: 1.4, kind: 'UNKNOWN' },
    { fromMin: 2, toMin: 3, kind: 'PAUSED' },
  ],
  endMin: 3,
  hasData: true,
};

describe('SpeedChart (RT-303)', () => {
  it('keeps missing speeds as null so the line breaks instead of dropping to 0', () => {
    render(<SpeedChart series={series} summary="tóm tắt" />);
    const dataset = captured.props?.data.datasets[0];
    expect(dataset?.data).toEqual([
      { x: 0.1, y: 18 },
      { x: 0.2, y: 20 },
      { x: 0.5, y: null },
      { x: 1.5, y: 0 },
      { x: 1.6, y: 0 },
    ]);
    expect(dataset?.spanGaps).toBe(false);
  });

  it('passes the UNKNOWN/PAUSED bands to the band plugin and names them in the legend', () => {
    render(<SpeedChart series={series} summary="tóm tắt" />);
    expect(captured.props?.plugins?.map((p) => p.id)).toContain(BANDS_PLUGIN_ID);
    expect(captured.props?.options?.plugins?.rtBands?.bands).toEqual(series.bands);
    const legend = screen.getByTestId('speed-chart-legend');
    expect(legend).toHaveTextContent('Tốc độ (km/h)');
    expect(legend).toHaveTextContent('Không xác định');
    expect(legend).toHaveTextContent('Tạm dừng');
  });

  it('the time axis runs to the end of the trip, so trailing lost GPS or a pause stays visible', () => {
    render(<SpeedChart series={series} summary="tóm tắt" />);
    expect(captured.props?.options?.scales?.x?.max).toBe(3);
  });

  it('draws a dot for a speed that has a line break on both sides', () => {
    const isolated: SpeedSeries = {
      points: [
        { tMin: 0.1, kmh: 18 },
        { tMin: 0.2, kmh: 20 },
        { tMin: 0.5, kmh: null },
        { tMin: 0.9, kmh: 25 },
        { tMin: 1.2, kmh: null },
      ],
      bands: [],
      endMin: 1.2,
      hasData: true,
    };
    render(<SpeedChart series={isolated} summary="tóm tắt" />);
    const radius = captured.props?.data.datasets[0]?.pointRadius;
    expect(Array.isArray(radius) ? radius.map((r) => r > 0) : radius).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it('describes the chart for screen readers', () => {
    render(<SpeedChart series={series} summary="Cao nhất 20 km/h" />);
    expect(screen.getByRole('img', { name: /Cao nhất 20 km\/h/ })).toBeInTheDocument();
  });

  it('without enough speeds shows a message and loads no chart', () => {
    render(
      <LazySpeedChart series={{ points: [], bands: [], endMin: 0, hasData: false }} summary="" />,
    );
    expect(screen.getByText('Chưa đủ dữ liệu tốc độ để vẽ biểu đồ.')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-canvas')).toBeNull();
  });
});

const fakeContext = () => ({
  save: vi.fn(),
  restore: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
});

describe('drawBands', () => {
  it('hatches UNKNOWN bands so they differ from pauses without relying on colour', () => {
    const ctx = fakeContext();
    const area = { left: 0, right: 200, top: 0, bottom: 50 };
    drawBands(ctx, area, (min) => min * 40, series.bands);
    expect(ctx.stroke).toHaveBeenCalledTimes(1); // the UNKNOWN band only
  });

  it('shades each band inside the chart area only', () => {
    const ctx = fakeContext();
    const { fillRect } = ctx;
    const area = { left: 10, right: 110, top: 0, bottom: 50 };
    const toPixel = (min: number): number => 10 + min * 40; // 0 → 10 px, 2.5 → 110 px
    drawBands(ctx, area, toPixel, series.bands);
    expect(fillRect).toHaveBeenNthCalledWith(1, 18, 0, 48, 50); // 0.2 → 18, 1.4 → 66
    expect(fillRect).toHaveBeenNthCalledWith(2, 90, 0, 20, 50); // 2 → 90, 3 → 130 clipped to 110
  });
});

describe('formatChartMinutes (x-axis, Q3: minutes since start)', () => {
  it('labels short and long trips as m:ss without duplicate ticks', () => {
    expect(formatChartMinutes(0)).toBe('0:00');
    expect(formatChartMinutes(0.05)).toBe('0:03');
    expect(formatChartMinutes(0.1)).toBe('0:06');
    expect(formatChartMinutes(1.5)).toBe('1:30');
    expect(formatChartMinutes(75)).toBe('75:00');
  });
});
