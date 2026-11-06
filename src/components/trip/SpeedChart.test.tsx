import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Line } from 'react-chartjs-2';
import { describe, expect, it, vi } from 'vitest';
import type { SpeedSeries } from '@/domain/analytics/speedSeries';
import { LazySpeedChart } from './LazySpeedChart';
import SpeedChart from './SpeedChart';
import { BANDS_PLUGIN_ID, drawBands } from './speedChartBands';

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

  it('describes the chart for screen readers', () => {
    render(<SpeedChart series={series} summary="Cao nhất 20 km/h" />);
    expect(screen.getByRole('img', { name: /Cao nhất 20 km\/h/ })).toBeInTheDocument();
  });

  it('without enough speeds shows a message and loads no chart', () => {
    render(<LazySpeedChart series={{ points: [], bands: [], hasData: false }} summary="" />);
    expect(screen.getByText('Chưa đủ dữ liệu tốc độ để vẽ biểu đồ.')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-canvas')).toBeNull();
  });
});

describe('drawBands', () => {
  it('shades each band inside the chart area only', () => {
    const fillRect = vi.fn();
    const ctx = { save: vi.fn(), restore: vi.fn(), fillRect, fillStyle: '' };
    const area = { left: 10, right: 110, top: 0, bottom: 50 };
    const toPixel = (min: number): number => 10 + min * 40; // 0 → 10 px, 2.5 → 110 px
    drawBands(ctx, area, toPixel, series.bands);
    expect(fillRect).toHaveBeenNthCalledWith(1, 18, 0, 48, 50); // 0.2 → 18, 1.4 → 66
    expect(fillRect).toHaveBeenNthCalledWith(2, 90, 0, 20, 50); // 2 → 90, 3 → 130 clipped to 110
  });
});
