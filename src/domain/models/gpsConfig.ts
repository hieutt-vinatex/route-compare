import type { TransportMode } from './types';

/**
 * Heuristic thresholds from docs/05-GPS-ALGORITHMS.md.
 * These are configurable starting points for field calibration — NOT accuracy guarantees,
 * and the outlier speeds are technical filters, NOT safety/legal speed limits.
 */
export interface GpsConfig {
  /** Options passed to watchPosition (§1). Not a guarantee of callback frequency. */
  readonly watch: {
    readonly enableHighAccuracy: boolean;
    readonly maximumAge: number;
    readonly timeout: number;
  };
  /** §3.3 — samples with accuracy above this are rejected as ACCURACY. */
  readonly maxAccuracyM: number;
  /** Reject samples whose provider gave no usable accuracy. */
  readonly requireAccuracy: boolean;
  /** §3.4 — a larger dt between accepted samples closes the segment (no bridging). */
  readonly maxGapMs: number;
  /**
   * Clock model (review I1/I2). offset = recordedAt − sourceTimestamp. Its median over the last
   * `windowSize` samples is the reference; a sample deviating by more than `toleranceMs` is
   * rejected (TIMESTAMP if stamped “in the future”, STALE if older than expected) and never
   * becomes the ordering anchor. A constant device clock skew is therefore harmless.
   * `minSamples`: fixes needed before the first one can be accepted (start calibration).
   */
  readonly clock: {
    readonly windowSize: number;
    readonly minSamples: number;
    readonly toleranceMs: number;
  };
  /** Fixes captured (estimated) earlier than boundary − tolerance are STALE after start/visible. */
  readonly boundaryToleranceMs: number;
  /** §3.6 — outlier gate: an edge faster than this even after subtracting both accuracy radii. */
  readonly outlierSpeedKmh: Readonly<Record<TransportMode, number>>;
  /**
   * §3.7 — drift filter: distance is counted from an anchor only once the fix moved at least
   * max(minStepM, uncertaintyFactor × √(accAnchor² + accFix²)).
   */
  readonly drift: {
    readonly minStepM: number;
    readonly uncertaintyFactor: number;
  };
  /** §6 — stop/move confirmation (M2). */
  readonly stop: {
    readonly speedKmh: number;
    readonly dwellMs: number;
    readonly radiusM: number;
  };
  /** §7 — median smoothing window for speeds. */
  readonly speedSmoothingWindow: number;
  /** §7 — centred median window (full windows only) for max/min/p95 speed statistics. */
  readonly speedStatsWindow: number;
  /** Live “current speed” needs this many edges in the open segment… */
  readonly liveSpeedMinEdges: number;
  /** …and the last accepted fix must be at most this old. */
  readonly liveSpeedMaxAgeMs: number;
  /** Displacement window for live speed when the provider reports no speed. */
  readonly liveSpeedWindowMs: number;
  /** STARTING timeout UX (SRS §6): after this, tell the user no adequate fix has arrived. */
  readonly startFixTimeoutMs: number;
  /** Throttled UI refresh (NFR-09); raw persistence is never throttled. */
  readonly uiRefreshMs: number;
  /** Restart watchPosition when the page becomes visible again (field-test knob). */
  readonly restartWatchOnVisible: boolean;
  /** Trip progress is written to storage this often while active (and when the page hides). */
  readonly checkpointMs: number;
  /** End gives up (trip kept, INTERRUPTED) when saving takes longer than this. */
  readonly finalizeTimeoutMs: number;
  /** §8 quality label v1 (M2). */
  readonly quality: {
    readonly goodCoveragePct: number;
    readonly goodMedianAccuracyM: number;
    readonly goodMaxLargeGaps: number;
    readonly fairCoveragePct: number;
  };
  /** §9 route grouping radius (M4). */
  readonly routeGroupRadiusM: number;
}

export const DEFAULT_GPS_CONFIG: GpsConfig = {
  watch: { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  maxAccuracyM: 30,
  requireAccuracy: true,
  maxGapMs: 20_000,
  clock: { windowSize: 5, minSamples: 2, toleranceMs: 5_000 },
  boundaryToleranceMs: 2_000,
  outlierSpeedKmh: { WALK: 12, BICYCLE: 65, MOTORBIKE: 150, CAR: 180 },
  drift: { minStepM: 2, uncertaintyFactor: 1 },
  stop: { speedKmh: 2, dwellMs: 15_000, radiusM: 20 },
  speedSmoothingWindow: 3,
  speedStatsWindow: 5,
  liveSpeedMinEdges: 2,
  liveSpeedMaxAgeMs: 10_000,
  liveSpeedWindowMs: 5_000,
  startFixTimeoutMs: 60_000,
  uiRefreshMs: 1_000,
  restartWatchOnVisible: true,
  checkpointMs: 15_000,
  finalizeTimeoutMs: 10_000,
  quality: {
    goodCoveragePct: 90,
    goodMedianAccuracyM: 25,
    goodMaxLargeGaps: 2,
    fairCoveragePct: 70,
  },
  routeGroupRadiusM: 150,
};

/**
 * metricsVersion stored on Trip (ADR-16).
 * 0 = provisional live progress (trip not finished); analytics fields are null.
 * 1 = docs/05 analytics from persisted raw data (analyzeTrip, M2).
 */
export const PROVISIONAL_METRICS_VERSION = 0;
export const METRICS_VERSION = 1;
