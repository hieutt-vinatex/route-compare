import { describe, expect, it } from 'vitest';
import {
  defaultTripName,
  EMPTY_VALUE,
  formatAccuracy,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  formatSpeedKmh,
  gpsErrorMessage,
  QUALITY_LABELS,
} from './format';

describe('format (vi-VN)', () => {
  it('formats distance in m below 1 km and km above', () => {
    expect(formatDistance(850.4)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1,23 km');
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(999.6)).toBe('1,00 km'); // never “1.000 m”
  });

  it('formats percentages and quality labels', () => {
    expect(formatPercent(83.4)).toBe('83 %');
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(QUALITY_LABELS.GOOD).toBe('Tốt');
  });

  it('formats durations', () => {
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('formats speed with unit and keeps missing values as “—” (never 0)', () => {
    expect(formatSpeedKmh(18)).toBe('18,0 km/h');
    expect(formatSpeedKmh(null)).toBe(EMPTY_VALUE);
    expect(formatDistance(null)).toBe(EMPTY_VALUE);
    expect(formatDuration(null)).toBe(EMPTY_VALUE);
    expect(formatAccuracy(Number.NaN)).toBe(EMPTY_VALUE);
  });

  it('builds the default trip name from local time', () => {
    const ts = new Date(2026, 10, 5, 7, 4).getTime();
    expect(formatDateTime(ts)).toBe('05/11/2026 07:04');
    expect(defaultTripName(ts)).toBe('Hành trình • 05/11/2026 07:04');
  });

  it('maps GPS errors to the Vietnamese copy', () => {
    expect(gpsErrorMessage({ code: 'PERMISSION_DENIED', message: '' })).toContain(
      'chưa được cấp quyền vị trí',
    );
    expect(gpsErrorMessage({ code: 'INSECURE_CONTEXT', message: '' })).toContain('HTTPS');
    expect(gpsErrorMessage(null)).toBeNull();
  });
});
