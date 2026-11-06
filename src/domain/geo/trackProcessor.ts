/**
 * Incremental GPS sample processor — docs/05-GPS-ALGORITHMS.md §2–§4, §10.
 *
 * Pure & immutable: `processSample(state, sample)` returns a new state plus the outcome
 * for that sample, so the same code runs live and in replay (analytics, recovery).
 *
 * Guarantees:
 * - Distance is only added inside ONE open segment, never across a boundary.
 * - A time gap (> maxGapMs on EITHER the fix clock or the app clock), a hidden page, a pause, a
 *   watcher restart or a clock regime change closes the segment; the next accepted sample opens
 *   a new segment and NO bridging distance is added.
 * - Fix timestamps are judged relative to a robust estimate of the offset between the fix
 *   clock and the app clock (median of recent samples), never against an assumed zero offset.
 * - Drift: distance grows from an anchor only when the fix moved further than the combined
 *   position uncertainty, so GPS jitter while standing still is not counted (§3.7, GPS-002).
 * - Outliers: an edge whose speed — even after subtracting both accuracy radii — exceeds the
 *   transport-mode limit is rejected as OUTLIER (§3.6, GPS-006). A rejected fix never becomes
 *   the reference, and a lasting relocation reopens a segment once maxGapMs has passed.
 */
import { median } from '../analytics/speed';
import type { GpsConfig } from '../models/gpsConfig';
import type { RawGpsSample, RejectCode, TransportMode } from '../models/types';
import { haversineM } from './haversine';
import { resolvedSpeedMps, stopConfirmedAt } from './motionEvidence';

export type SegmentOpenReason =
  'START' | 'AFTER_GAP' | 'AFTER_HIDDEN' | 'AFTER_PAUSE' | 'AFTER_RESTART' | 'AFTER_CLOCK_RESET';

export type BoundaryInput =
  | { readonly kind: 'PAGE_HIDDEN'; readonly at: number }
  | { readonly kind: 'PAGE_VISIBLE'; readonly at: number }
  | { readonly kind: 'WATCH_RESTART'; readonly at: number }
  | { readonly kind: 'PAUSE'; readonly at: number }
  | { readonly kind: 'RESUME'; readonly at: number };

export interface AcceptedFix {
  readonly lat: number;
  readonly lng: number;
  readonly sourceTimestamp: number;
  readonly recordedAt: number;
  readonly accuracyM: number | null;
  /** Provider (Doppler) speed, m/s, or null. */
  readonly speedMps: number | null;
  readonly segmentId: number;
}

export type RejectCounts = Readonly<Partial<Record<RejectCode, number>>>;

/** Fixes of the open segment kept for live speed and stop confirmation (bounded). */
const RECENT_FIXES_MAX = 120;

export interface TrackProcessorState {
  readonly transportMode: TransportMode;
  readonly hidden: boolean;
  /** User pause: nothing is measured until RESUME (pause time is PAUSED, not UNKNOWN). */
  readonly paused: boolean;
  /** App-clock time of the last start/visible/restart boundary; earlier fixes are STALE. */
  readonly boundaryAt: number | null;
  /** Offsets (recordedAt − sourceTimestamp) of the last timestamp-valid samples. */
  readonly offsetWindow: readonly number[];
  /**
   * Reference offset at the last accepted fix. It follows slow drift (updated on every accept);
   * only a sudden jump of the median by more than the tolerance counts as a clock change.
   */
  readonly regimeOffsetMs: number | null;
  /** Last sample that passed the timestamp gate (for ordering/duplicate checks). */
  readonly lastSeen: {
    readonly sourceTimestamp: number;
    readonly lat: number;
    readonly lng: number;
  } | null;
  readonly firstAccepted: AcceptedFix | null;
  readonly lastAccepted: AcceptedFix | null;
  /** Last fix where distance was counted in the open segment (drift filter). */
  readonly distanceAnchor: AcceptedFix | null;
  /** Accepted fixes of the open segment, oldest first, ≤ RECENT_FIXES_MAX. */
  readonly recentFixes: readonly AcceptedFix[];
  readonly openSegmentId: number | null;
  /** Highest segment id assigned so far; 0 = none. Ids start at 1. */
  readonly lastSegmentId: number;
  readonly nextOpenReason: SegmentOpenReason;
  readonly distanceMeasuredM: number;
  /** Number of edges (pairs of consecutive accepted samples inside one segment). */
  readonly measuredEdgeCount: number;
  readonly rawCount: number;
  readonly acceptedCount: number;
  readonly rejectCounts: RejectCounts;
  /** Time gaps (> maxGapMs) detected between accepted samples. */
  readonly gapCount: number;
  /** Number of hidden intervals. */
  readonly hiddenCount: number;
  /** Clock regime changes (lasting jump of the fix/app clock offset). */
  readonly clockResetCount: number;
}

export interface OpenedSegment {
  readonly reason: SegmentOpenReason;
  /** Present when the segment was opened because of a time gap (on either clock). */
  readonly gap: {
    readonly fromSourceTimestamp: number;
    readonly toSourceTimestamp: number;
    readonly fromRecordedAt: number;
    readonly toRecordedAt: number;
  } | null;
}

export interface SampleOutcome {
  readonly accepted: boolean;
  readonly rejectCode: RejectCode | null;
  readonly segmentId: number | null;
  /** Meters added to distanceMeasuredM by this sample (0 when it opened a segment). */
  readonly distanceAddedM: number;
  /** Raw edge speed: distance / dt from the previous accepted sample of the same segment. */
  readonly derivedSpeedMps: number | null;
  readonly openedSegment: OpenedSegment | null;
}

export interface ProcessResult {
  readonly state: TrackProcessorState;
  readonly outcome: SampleOutcome;
}

export interface CreateTrackProcessorOptions {
  /** Trip start (app clock). Fixes captured (estimated) before it are STALE. */
  readonly startedAt?: number;
  /** Selects the outlier speed limit. Defaults to the most permissive mode (CAR). */
  readonly transportMode?: TransportMode;
}

export function createTrackProcessor(
  _config: GpsConfig,
  options: CreateTrackProcessorOptions = {},
): TrackProcessorState {
  return {
    transportMode: options.transportMode ?? 'CAR',
    hidden: false,
    paused: false,
    boundaryAt: options.startedAt ?? null,
    offsetWindow: [],
    regimeOffsetMs: null,
    lastSeen: null,
    firstAccepted: null,
    lastAccepted: null,
    distanceAnchor: null,
    recentFixes: [],
    openSegmentId: null,
    lastSegmentId: 0,
    nextOpenReason: 'START',
    distanceMeasuredM: 0,
    measuredEdgeCount: 0,
    rawCount: 0,
    acceptedCount: 0,
    rejectCounts: {},
    gapCount: 0,
    hiddenCount: 0,
    clockResetCount: 0,
  };
}

/** RANGE gate (§3.1). Also used by the Home location preview. */
export function hasValidRange(sample: RawGpsSample): boolean {
  const { latitude, longitude, accuracyM } = sample;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  // Exact (0,0) (“Null Island”) is a common failure value of location providers.
  if (latitude === 0 && longitude === 0) return false;
  if (accuracyM !== null && (!Number.isFinite(accuracyM) || accuracyM <= 0)) return false;
  return Number.isFinite(sample.recordedAt);
}

/** ACCURACY gate (§3.3). */
export function hasSufficientAccuracy(sample: RawGpsSample, config: GpsConfig): boolean {
  if (sample.accuracyM === null) return !config.requireAccuracy;
  return sample.accuracyM <= config.maxAccuracyM;
}

export function processSample(
  state: TrackProcessorState,
  sample: RawGpsSample,
  config: GpsConfig,
): ProcessResult {
  const counted: TrackProcessorState = { ...state, rawCount: state.rawCount + 1 };

  if (!hasValidRange(sample)) return reject(counted, 'RANGE');

  const ts = sample.sourceTimestamp;
  if (!Number.isFinite(ts) || ts <= 0) return reject(counted, 'TIMESTAMP');

  // Clock model: judge this fix's timestamp against the recent offset regime.
  const offset = sample.recordedAt - ts;
  const offsetWindow = [...state.offsetWindow, offset].slice(-Math.max(1, config.clock.windowSize));
  const ref = median(offsetWindow) ?? offset;
  let clocked: TrackProcessorState = { ...counted, offsetWindow };
  if (offsetWindow.length < config.clock.minSamples) return reject(clocked, 'UNTRUSTED');
  const deviation = offset - ref;
  if (deviation < -config.clock.toleranceMs) return reject(clocked, 'TIMESTAMP');
  if (deviation > config.clock.toleranceMs) return reject(clocked, 'STALE');

  // The majority of recent fixes moved to a new offset: the clock changed. Never connect
  // fixes across it, and restart timestamp ordering in the new regime.
  if (
    state.regimeOffsetMs !== null &&
    Math.abs(ref - state.regimeOffsetMs) > config.clock.toleranceMs
  ) {
    const closed =
      state.openSegmentId === null ? clocked : closeSegment(clocked, 'AFTER_CLOCK_RESET');
    clocked = {
      ...closed,
      lastSeen: null,
      regimeOffsetMs: ref,
      clockResetCount: clocked.clockResetCount + 1,
    };
  }

  const seen = clocked.lastSeen;
  if (seen !== null) {
    if (ts === seen.sourceTimestamp) {
      const sameCoords = seen.lat === sample.latitude && seen.lng === sample.longitude;
      return reject(clocked, sameCoords ? 'DUPLICATE' : 'TIMESTAMP');
    }
    if (ts < seen.sourceTimestamp) return reject(clocked, 'TIMESTAMP');
  }

  const timed: TrackProcessorState = {
    ...clocked,
    lastSeen: { sourceTimestamp: ts, lat: sample.latitude, lng: sample.longitude },
  };

  if (state.hidden || state.paused) return reject(timed, 'UNTRUSTED');
  // Estimated capture time on the app clock = fix time + reference offset.
  if (timed.boundaryAt !== null && ts + ref < timed.boundaryAt - config.boundaryToleranceMs) {
    return reject(timed, 'STALE');
  }
  if (!hasSufficientAccuracy(sample, config)) return reject(timed, 'ACCURACY');

  return accept(timed, sample, config, ref);
}

function reject(state: TrackProcessorState, code: RejectCode): ProcessResult {
  return {
    state: {
      ...state,
      rejectCounts: { ...state.rejectCounts, [code]: (state.rejectCounts[code] ?? 0) + 1 },
    },
    outcome: {
      accepted: false,
      rejectCode: code,
      segmentId: null,
      distanceAddedM: 0,
      derivedSpeedMps: null,
      openedSegment: null,
    },
  };
}

function accept(
  state: TrackProcessorState,
  sample: RawGpsSample,
  config: GpsConfig,
  offsetRef: number,
): ProcessResult {
  const prev = state.lastAccepted;
  const segmentOpen =
    state.openSegmentId !== null && prev !== null && prev.segmentId === state.openSegmentId;

  if (!segmentOpen) {
    return openSegment(state, sample, { reason: state.nextOpenReason, gap: null }, offsetRef);
  }

  const dtMs = sample.sourceTimestamp - prev.sourceTimestamp;
  const dtAppMs = sample.recordedAt - prev.recordedAt;
  // Either clock showing a long silence means the interval was not measured.
  if (dtMs > config.maxGapMs || dtAppMs > config.maxGapMs) {
    const opened = openSegment(
      state,
      sample,
      {
        reason: 'AFTER_GAP',
        gap: {
          fromSourceTimestamp: prev.sourceTimestamp,
          toSourceTimestamp: sample.sourceTimestamp,
          fromRecordedAt: prev.recordedAt,
          toRecordedAt: sample.recordedAt,
        },
      },
      offsetRef,
    );
    return { ...opened, state: { ...opened.state, gapCount: opened.state.gapCount + 1 } };
  }

  // Same segment: dtMs > 0 is guaranteed by the strictly-increasing timestamp gate.
  const fix = toFix(sample, prev.segmentId);
  const dtS = dtMs / 1000;
  const edgeM = haversineM(prev, fix);

  // Outlier gate (§3.6): even the most favourable reading of both accuracy circles is too fast.
  const minPossibleM = Math.max(0, edgeM - (prev.accuracyM ?? 0) - (fix.accuracyM ?? 0));
  if (minPossibleM / dtS > config.outlierSpeedKmh[state.transportMode] / 3.6) {
    return reject(state, 'OUTLIER');
  }

  // Drift filter (§3.7): count distance from the anchor once the move exceeds the uncertainty.
  const anchor = state.distanceAnchor ?? prev;
  const fromAnchorM = haversineM(anchor, fix);
  const thresholdM = Math.max(
    config.drift.minStepM,
    config.drift.uncertaintyFactor * Math.hypot(anchor.accuracyM ?? 0, fix.accuracyM ?? 0),
  );
  const counts = fromAnchorM >= thresholdM;
  const addedM = counts ? fromAnchorM : 0;

  return {
    state: {
      ...state,
      regimeOffsetMs: offsetRef,
      lastAccepted: fix,
      distanceAnchor: counts ? fix : anchor,
      recentFixes: [...state.recentFixes, fix].slice(-RECENT_FIXES_MAX),
      acceptedCount: state.acceptedCount + 1,
      distanceMeasuredM: state.distanceMeasuredM + addedM,
      measuredEdgeCount: state.measuredEdgeCount + 1,
    },
    outcome: {
      accepted: true,
      rejectCode: null,
      segmentId: prev.segmentId,
      distanceAddedM: addedM,
      derivedSpeedMps: edgeM / dtS,
      openedSegment: null,
    },
  };
}

function openSegment(
  state: TrackProcessorState,
  sample: RawGpsSample,
  opened: OpenedSegment,
  offsetRef: number,
): ProcessResult {
  const segmentId = state.lastSegmentId + 1;
  const fix = toFix(sample, segmentId);
  return {
    state: {
      ...state,
      regimeOffsetMs: offsetRef,
      firstAccepted: state.firstAccepted ?? fix,
      lastAccepted: fix,
      distanceAnchor: fix,
      recentFixes: [fix],
      openSegmentId: segmentId,
      lastSegmentId: segmentId,
      acceptedCount: state.acceptedCount + 1,
    },
    outcome: {
      accepted: true,
      rejectCode: null,
      segmentId,
      distanceAddedM: 0,
      derivedSpeedMps: null,
      openedSegment: opened,
    },
  };
}

function toFix(sample: RawGpsSample, segmentId: number): AcceptedFix {
  return {
    lat: sample.latitude,
    lng: sample.longitude,
    sourceTimestamp: sample.sourceTimestamp,
    recordedAt: sample.recordedAt,
    accuracyM: sample.accuracyM,
    speedMps: sample.speedMps,
    segmentId,
  };
}

function closeSegment(state: TrackProcessorState, reason: SegmentOpenReason): TrackProcessorState {
  return {
    ...state,
    openSegmentId: null,
    // The very first segment keeps reason START even if a boundary happened before it.
    nextOpenReason: state.lastSegmentId === 0 ? 'START' : reason,
    distanceAnchor: null,
    recentFixes: [],
  };
}

function laterOf(current: number | null, next: number): number {
  return current === null ? next : Math.max(current, next);
}

/** Apply a lifecycle boundary (docs/05 §3.5). Never adds distance. */
export function applyBoundary(
  state: TrackProcessorState,
  boundary: BoundaryInput,
  _config: GpsConfig,
): TrackProcessorState {
  switch (boundary.kind) {
    case 'PAGE_HIDDEN':
      if (state.hidden) return state;
      return {
        ...closeSegment(state, 'AFTER_HIDDEN'),
        hidden: true,
        hiddenCount: state.hiddenCount + 1,
      };
    case 'PAGE_VISIBLE':
      if (!state.hidden) return state;
      return {
        ...closeSegment(state, 'AFTER_HIDDEN'),
        hidden: false,
        boundaryAt: laterOf(state.boundaryAt, boundary.at),
      };
    case 'WATCH_RESTART':
      // A restart only happens on a visible page (continue button / reload recovery), so a
      // hidden state left behind by a closed page must not block the new fixes.
      return {
        ...closeSegment(state, 'AFTER_RESTART'),
        hidden: false,
        boundaryAt: laterOf(state.boundaryAt, boundary.at),
      };
    case 'PAUSE':
      if (state.paused) return state;
      return { ...closeSegment(state, 'AFTER_PAUSE'), paused: true };
    case 'RESUME':
      if (!state.paused) return state;
      return {
        ...closeSegment(state, 'AFTER_PAUSE'),
        paused: false,
        boundaryAt: laterOf(state.boundaryAt, boundary.at),
      };
  }
}

/** True while the open segment has a recent accepted fix (app clock). */
export function hasFreshFix(state: TrackProcessorState, now: number, config: GpsConfig): boolean {
  return (
    state.openSegmentId !== null &&
    state.lastAccepted !== null &&
    now - state.lastAccepted.recordedAt <= config.maxGapMs
  );
}

/**
 * Live “current speed” (m/s), or null when there is not enough recent evidence (UI shows “—”).
 * 1. Provider speed (coords.speed, Doppler) when the last fixes report it: median of the last
 *    `speedSmoothingWindow` values.
 * 2. 0 only for a confirmed stop (BR-07): the last stop.dwellMs of fixes are compact and slow.
 * 3. Otherwise the median, over the last `speedSmoothingWindow` fixes, of the displacement speed
 *    resolved beyond the position uncertainty (motionEvidence.resolvedSpeedMps) over a base of
 *    ≤ liveSpeedWindowMs — reaching further back (slow walking) until the displacement leaves the
 *    uncertainty. Movement still inside the uncertainty is unknown (null), never 0.
 */
export function liveSpeedMps(
  state: TrackProcessorState,
  now: number,
  config: GpsConfig,
): number | null {
  const last = state.lastAccepted;
  if (state.openSegmentId === null || last === null) return null;
  if (now - last.recordedAt > config.liveSpeedMaxAgeMs) return null;
  const fixes = state.recentFixes;
  if (fixes.length < config.liveSpeedMinEdges + 1) return null;

  const provider = fixes
    .slice(-config.speedSmoothingWindow)
    .map((f) => f.speedMps)
    .filter((v): v is number => v !== null);
  if (provider.length >= Math.min(config.liveSpeedMinEdges, config.speedSmoothingWindow)) {
    return median(provider);
  }

  if (stopConfirmedAt(fixes, fixes.length - 1, config)) return 0;

  // Median over the last few window ends, so one spike cannot dominate.
  const first = fixes[0];
  const speeds: number[] = [];
  for (let i = Math.max(0, fixes.length - config.speedSmoothingWindow); i < fixes.length; i += 1) {
    const end = fixes[i];
    if (first === undefined || end === undefined) continue;
    // Early in a segment the base is whatever span exists (≥ liveSpeedMinEdges edges).
    const minBaseMs = Math.min(
      config.liveSpeedWindowMs,
      end.sourceTimestamp - first.sourceTimestamp,
    );
    if (minBaseMs <= 0) continue;
    const v = resolvedSpeedMps(fixes, i, config, minBaseMs);
    if (v !== null) speeds.push(v);
  }
  return median(speeds);
}
