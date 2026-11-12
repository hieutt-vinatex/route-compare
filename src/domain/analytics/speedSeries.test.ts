// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { T0 } from '@/tests/fixtures/gpsFixtures';
import type { ClassifiedEdge, EdgeClass } from './classify';
import { buildSpeedSeries, type SpeedSeriesInput } from './speedSeries';

const MIN = 60_000;

/** Contiguous 1 s edges from `fromS` (seconds after T0), one class and speed (m/s). */
function run(fromS: number, count: number, cls: EdgeClass, speedMps: number | null) {
  return Array.from({ length: count }, (_, i): ClassifiedEdge => ({
    from: T0 + (fromS + i) * 1000,
    to: T0 + (fromS + i + 1) * 1000,
    cls,
    speedMps,
    statSpeedMps: speedMps,
  }));
}

function input(edges: ClassifiedEdge[], extra: Partial<SpeedSeriesInput> = {}): SpeedSeriesInput {
  return { edges, unmeasured: [], paused: [], ...extra };
}

const values = (s: ReturnType<typeof buildSpeedSeries>) => s.points.map((p) => p.kmh);

describe('buildSpeedSeries (RT-303)', () => {
  it('plots km/h at each edge end, minutes since the start', () => {
    const s = buildSpeedSeries(input(run(0, 3, 'MOVING', 5)), T0);
    expect(s.points).toEqual([
      { tMin: 1 / 60, kmh: 18 },
      { tMin: 2 / 60, kmh: 18 },
      { tMin: 3 / 60, kmh: 18 },
    ]);
    expect(s.hasData).toBe(true);
  });

  it('an UNKNOWN edge is a line break and a shaded band, never 0', () => {
    const edges = [
      ...run(0, 3, 'MOVING', 5),
      ...run(3, 4, 'UNKNOWN', 0.3),
      ...run(7, 3, 'MOVING', 5),
    ];
    const s = buildSpeedSeries(input(edges), T0);
    expect(values(s)).not.toContain(0);
    expect(values(s).slice(3, 7)).toEqual([null, null, null, null]);
    expect(s.bands).toEqual([{ fromMin: 3 / 60, toMin: 7 / 60, kind: 'UNKNOWN' }]);
  });

  it('an edge without speed evidence is a line break, never 0', () => {
    const edges = [
      ...run(0, 3, 'MOVING', 5),
      ...run(3, 1, 'MOVING', null),
      ...run(4, 3, 'MOVING', 5),
    ];
    expect(values(buildSpeedSeries(input(edges), T0))[3]).toBeNull();
  });

  it('a confirmed stop plots 0', () => {
    const edges = [...run(0, 3, 'MOVING', 5), ...run(3, 20, 'STOPPED', 0.2)];
    const s = buildSpeedSeries(input(edges), T0);
    expect(values(s).at(-1)).toBe(0);
    expect(s.bands).toEqual([]);
  });

  it('a gap between segments breaks the line and is an UNKNOWN band', () => {
    const edges = [...run(0, 5, 'MOVING', 5), ...run(95, 5, 'MOVING', 5)];
    const gap = { from: T0 + 5_000, to: T0 + 95_000 };
    const s = buildSpeedSeries(input(edges, { unmeasured: [gap] }), T0);
    const breakAt = s.points.findIndex((p) => p.kmh === null);
    expect(breakAt).toBe(5);
    expect(s.points[breakAt]?.tMin).toBeGreaterThan(5 / 60);
    expect(s.points[breakAt]?.tMin).toBeLessThan(95 / 60);
    expect(s.bands).toEqual([{ fromMin: 5 / 60, toMin: 95 / 60, kind: 'UNKNOWN' }]);
  });

  it('a pause is a PAUSED band, not UNKNOWN, and also breaks the line', () => {
    const edges = [...run(0, 5, 'MOVING', 5), ...run(65, 5, 'MOVING', 5)];
    const pause = { from: T0 + 5_000, to: T0 + 65_000 };
    const s = buildSpeedSeries(input(edges, { paused: [pause] }), T0);
    expect(s.bands).toEqual([{ fromMin: 5 / 60, toMin: 65 / 60, kind: 'PAUSED' }]);
    expect(values(s)).toContain(null);
  });

  it('10 000 edges → at most 600 points, a 1-minute burst survives the bucket mean', () => {
    const edges = [
      ...run(0, 5_000, 'MOVING', 10),
      ...run(5_000, 60, 'MOVING', 20),
      ...run(5_060, 4_940, 'MOVING', 10),
    ];
    const s = buildSpeedSeries(input(edges), T0);
    expect(s.points.length).toBeLessThanOrEqual(600);
    expect(Math.max(...values(s).filter((v): v is number => v !== null))).toBeCloseTo(72, 0);
    expect(s.points.at(-1)?.tMin).toBeCloseTo(10_000 / 60, 0);
  });

  it('bucketing keeps every gap as a break', () => {
    const edges = [...run(0, 5_000, 'MOVING', 10), ...run(5_030, 5_000, 'MOVING', 10)];
    const gap = { from: T0 + 5_000_000, to: T0 + 5_030_000 };
    const s = buildSpeedSeries(input(edges, { unmeasured: [gap] }), T0);
    expect(s.points.length).toBeLessThanOrEqual(600);
    expect(values(s).filter((v) => v === null)).toHaveLength(1);
  });

  it('reports where the trip ends, including trailing time without GPS', () => {
    const lost = { from: T0 + 5_000, to: T0 + 15 * MIN };
    const s = buildSpeedSeries(input(run(0, 5, 'MOVING', 5), { unmeasured: [lost] }), T0);
    expect(s.endMin).toBe(15);
    expect(buildSpeedSeries(input(run(0, 6, 'MOVING', 5)), T0).endMin).toBe(0.1);
  });

  it('fewer than 2 speeds → hasData false', () => {
    expect(buildSpeedSeries(input([]), T0).hasData).toBe(false);
    expect(buildSpeedSeries(input(run(0, 1, 'MOVING', 5)), T0).hasData).toBe(false);
    expect(buildSpeedSeries(input(run(0, 9, 'UNKNOWN', null)), T0).hasData).toBe(false);
  });

  it('uses minutes for band edges', () => {
    const s = buildSpeedSeries(input([], { paused: [{ from: T0 + MIN, to: T0 + 3 * MIN }] }), T0);
    expect(s.bands).toEqual([{ fromMin: 1, toMin: 3, kind: 'PAUSED' }]);
  });
});
