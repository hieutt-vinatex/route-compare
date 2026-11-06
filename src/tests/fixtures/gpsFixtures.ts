/**
 * Synthetic GPS replay fixtures (docs/05 §11). Deterministic; no real user locations.
 * Offsets are ms from T0; recordedAt = sourceTimestamp + latency (default 200 ms).
 */
import { destinationPoint } from '@/domain/geo/haversine';
import {
  createTrackProcessor,
  processSample,
  type CreateTrackProcessorOptions,
  type TrackProcessorState,
} from '@/domain/geo/trackProcessor';
import type { GpsConfig } from '@/domain/models/gpsConfig';
import type { LatLng, RawGpsSample } from '@/domain/models/types';

/** 2026-11-05 08:00:00 +07:00 */
export const T0 = Date.UTC(2026, 10, 5, 1, 0, 0);
export const ORIGIN: LatLng = { lat: 21.0285, lng: 105.8542 };
export const DEFAULT_LATENCY_MS = 200;

export interface SampleSpec {
  readonly t: number;
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM?: number | null;
  readonly speedMps?: number | null;
  readonly headingDeg?: number | null;
  readonly latencyMs?: number;
}

export function toSample(spec: SampleSpec, base = T0): RawGpsSample {
  const sourceTimestamp = base + spec.t;
  return {
    sourceTimestamp,
    recordedAt: sourceTimestamp + (spec.latencyMs ?? DEFAULT_LATENCY_MS),
    latitude: spec.lat,
    longitude: spec.lng,
    accuracyM: spec.accuracyM === undefined ? 5 : spec.accuracyM,
    speedMps: spec.speedMps === undefined ? null : spec.speedMps,
    headingDeg: spec.headingDeg === undefined ? null : spec.headingDeg,
  };
}

export interface StraightLineOptions {
  readonly from?: LatLng;
  readonly bearingDeg?: number;
  readonly speedMps?: number;
  readonly intervalMs?: number;
  readonly count: number;
  readonly startT?: number;
  readonly accuracyM?: number;
  readonly reportSpeed?: boolean;
}

/** STRAIGHT: constant speed along a bearing, stable timestamps. */
export function straightLine(options: StraightLineOptions): SampleSpec[] {
  const {
    from = ORIGIN,
    bearingDeg = 90,
    speedMps = 5,
    intervalMs = 1000,
    count,
    startT = 0,
    accuracyM = 5,
    reportSpeed = false,
  } = options;
  const out: SampleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = destinationPoint(from, bearingDeg, (speedMps * (i * intervalMs)) / 1000);
    out.push({
      t: startT + i * intervalMs,
      lat: p.lat,
      lng: p.lng,
      accuracyM,
      speedMps: reportSpeed ? speedMps : null,
    });
  }
  return out;
}

/** Deterministic PRNG (LCG) for jitter fixtures. */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

/** STATIONARY: jitter within `radiusM` around a point. */
export function stationaryJitter(options: {
  readonly center?: LatLng;
  readonly count: number;
  readonly intervalMs?: number;
  readonly radiusM?: number;
  readonly startT?: number;
  readonly accuracyM?: number;
  readonly seed?: number;
}): SampleSpec[] {
  const {
    center = ORIGIN,
    count,
    intervalMs = 1000,
    radiusM = 4,
    startT = 0,
    accuracyM = 8,
    seed = 7,
  } = options;
  const random = seededRandom(seed);
  const out: SampleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = destinationPoint(center, random() * 360, random() * radiusM);
    out.push({ t: startT + i * intervalMs, lat: p.lat, lng: p.lng, accuracyM });
  }
  return out;
}

export function lastOf<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error('empty fixture');
  return item;
}

/**
 * A processor that has already seen one clock-calibration fix (rejected as UNTRUSTED, offset =
 * DEFAULT_LATENCY_MS), so the next fix can be accepted. Mirrors the first callback of a real trip.
 */
export function calibratedProcessor(
  config: GpsConfig,
  options: CreateTrackProcessorOptions = {},
  calibrationT = -1_000,
): TrackProcessorState {
  const initial = createTrackProcessor(config, options);
  return processSample(
    initial,
    toSample({ t: calibrationT, lat: ORIGIN.lat, lng: ORIGIN.lng }),
    config,
  ).state;
}
