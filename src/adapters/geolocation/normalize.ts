import type { GpsError, RawGpsSample } from '@/domain/models/types';

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * GeolocationPosition → RawGpsSample. Units are kept (degrees, m, m/s, epoch ms).
 * Missing/NaN speed or heading becomes null — never 0.
 */
export function normalizePosition(position: GeolocationPosition, recordedAt: number): RawGpsSample {
  const c = position.coords;
  const speed = finiteOrNull(c.speed);
  return {
    sourceTimestamp: position.timestamp,
    recordedAt,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracyM: finiteOrNull(c.accuracy),
    speedMps: speed !== null && speed >= 0 ? speed : null,
    headingDeg: finiteOrNull(c.heading),
  };
}

/** GeolocationPositionError codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT. */
export function mapPositionError(error: GeolocationPositionError): GpsError {
  switch (error.code) {
    case 1:
      return { code: 'PERMISSION_DENIED', message: error.message };
    case 3:
      return { code: 'TIMEOUT', message: error.message };
    default:
      return { code: 'POSITION_UNAVAILABLE', message: error.message };
  }
}
