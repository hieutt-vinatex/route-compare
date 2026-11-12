/** Band shading for the speed chart: UNKNOWN / PAUSED time behind the line (docs/06 §4). */
import type { ChartType, Plugin } from 'chart.js';
import type { SpeedBand } from '@/domain/analytics/speedSeries';

export const BANDS_PLUGIN_ID = 'rtBands';

interface BandsOptions {
  readonly bands: readonly SpeedBand[];
}

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must match Chart.js's declaration
  interface PluginOptionsByType<TType extends ChartType> {
    rtBands?: BandsOptions;
  }
}

const BAND_COLORS: Readonly<Record<SpeedBand['kind'], string>> = {
  UNKNOWN: 'rgba(100, 116, 139, 0.22)', // slate-500
  PAUSED: 'rgba(14, 165, 233, 0.18)', // sky-500
};
export const LINE_COLOR = '#0f766e'; // teal-700

interface Area {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface BandContext {
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
}

/** Diagonal hatch spacing (px) for UNKNOWN bands — told apart from pauses by pattern, not colour. */
const HATCH_PX = 8;
export const HATCH_COLOR = 'rgba(71, 85, 105, 0.55)'; // slate-600

/** Fill each band across the full chart height, clipped to the chart area. */
export function drawBands(
  ctx: BandContext,
  area: Area,
  toPixel: (minutes: number) => number,
  bands: readonly SpeedBand[],
): void {
  ctx.save();
  for (const band of bands) {
    const x0 = Math.max(area.left, toPixel(band.fromMin));
    const x1 = Math.min(area.right, toPixel(band.toMin));
    if (x1 <= x0) continue;
    const height = area.bottom - area.top;
    ctx.fillStyle = BAND_COLORS[band.kind];
    ctx.fillRect(x0, area.top, x1 - x0, height);
    if (band.kind !== 'UNKNOWN') continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, area.top, x1 - x0, height);
    ctx.clip();
    ctx.beginPath();
    for (let x = x0 - height; x < x1; x += HATCH_PX) {
      ctx.moveTo(x, area.bottom);
      ctx.lineTo(x + height, area.top);
    }
    ctx.strokeStyle = HATCH_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export const bandsPlugin: Plugin<'line', BandsOptions> = {
  id: BANDS_PLUGIN_ID,
  beforeDatasetsDraw(chart, _args, options) {
    const x = chart.scales.x;
    if (x === undefined) return;
    drawBands(chart.ctx, chart.chartArea, (m) => x.getPixelForValue(m), options.bands);
  },
};
