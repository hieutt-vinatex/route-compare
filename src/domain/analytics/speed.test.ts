import { describe, expect, it } from 'vitest';
import { avgElapsedKmh, median, mpsToKmh } from './speed';

describe('speed helpers', () => {
  it('converts m/s to km/h', () => {
    expect(mpsToKmh(10)).toBeCloseTo(36, 9);
  });

  it('median of odd/even/empty lists', () => {
    expect(median([5, 50, 4])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('avgElapsedKmh = distance / elapsed × 3.6, null without evidence', () => {
    expect(avgElapsedKmh(1000, 120_000, 10)).toBeCloseTo(30, 9);
    expect(avgElapsedKmh(0, 120_000, 0)).toBeNull(); // no measured edge → “—”, not 0
    expect(avgElapsedKmh(1000, 0, 10)).toBeNull();
  });
});
