import { describe, expect, it } from 'vitest';
import { destinationPoint, EARTH_RADIUS_M, haversineM } from './haversine';

/** Independent oracle: spherical law of cosines (fine for non-tiny distances). */
function lawOfCosinesM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const c =
    Math.sin(a.lat * r) * Math.sin(b.lat * r) +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return EARTH_RADIUS_M * Math.acos(Math.min(1, Math.max(-1, c)));
}

describe('GPS-001 Haversine', () => {
  it('1° of longitude on the equator = 2πR/360', () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      (2 * Math.PI * EARTH_RADIUS_M) / 360,
      3,
    );
  });

  it('1° of latitude on a meridian = 2πR/360', () => {
    expect(haversineM({ lat: 10, lng: 105 }, { lat: 11, lng: 105 })).toBeCloseTo(111_194.93, 1);
  });

  it.each([
    [
      { lat: 21.0285, lng: 105.8542 },
      { lat: 10.7769, lng: 106.7009 },
    ], // Hà Nội ↔ TP.HCM
    [
      { lat: 21.0285, lng: 105.8542 },
      { lat: 21.0368, lng: 105.8342 },
    ],
    [
      { lat: -33.86, lng: 151.21 },
      { lat: 51.5, lng: -0.12 },
    ],
  ])('matches the law-of-cosines oracle within 1 mm (%o → %o)', (a, b) => {
    expect(Math.abs(haversineM(a, b) - lawOfCosinesM(a, b))).toBeLessThan(0.001);
  });

  it('is symmetric and zero for identical points', () => {
    const a = { lat: 21.03, lng: 105.85 };
    const b = { lat: 21.04, lng: 105.86 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9);
    expect(haversineM(a, a)).toBe(0);
  });

  it('antipodal points are πR apart (no NaN from rounding)', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
  });

  it('handles the antimeridian', () => {
    expect(haversineM({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })).toBeCloseTo(22_238.99, 1);
  });
});

describe('destinationPoint (fixture builder)', () => {
  it.each([0, 45, 90, 180, 270, 333])('round-trips distance along bearing %d°', (bearing) => {
    const origin = { lat: 21.0285, lng: 105.8542 };
    for (const meters of [1, 5, 100, 2_500]) {
      expect(haversineM(origin, destinationPoint(origin, bearing, meters))).toBeCloseTo(meters, 6);
    }
  });

  it('normalises longitude into [-180, 180)', () => {
    const p = destinationPoint({ lat: 0, lng: 179.99 }, 90, 5_000);
    expect(p.lng).toBeLessThan(-179);
  });
});
