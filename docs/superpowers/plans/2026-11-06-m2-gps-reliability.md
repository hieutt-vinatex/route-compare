# M2 — GPS reliability & local data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every trip in IndexedDB, compute the full docs/05 metrics (drift/outlier filters, MOVING/STOPPED/UNKNOWN/PAUSED partition, speeds, coverage, quality) from raw data, add Pause/Resume, reload recovery and a single-recorder lock across tabs.

**Architecture:** Dexie becomes the `TripRepository` behind the existing port; the live `trackProcessor` keeps driving the UI, while a pure `analyzeTrip()` replays persisted raw points + events (ordered by one per-trip sequence) and is the source of truth for the final summary (`metricsVersion = 1`). Recovery and the tab lock live in the controller/adapters; React only reads through hooks.

**Tech Stack:** dexie ^4.4.7, dexie-react-hooks ^4.4.0, fake-indexeddb ^6.2.7 (dev) — on top of the M0/M1 stack.

**Spec:** `docs/02-SRS.md`, `docs/04-DATA-MODEL.md`, `docs/05-GPS-ALGORITHMS.md`, `docs/07-TEST-PLAN.md`, `docs/08-ROADMAP.md` (RT-201…RT-207), review findings in the M0/M1 review.

## Global Constraints

- Units in domain: m, ms (epoch UTC), m/s; UI km, km/h. Missing → `null`, shown “—”, never 0 (AGENTS.md).
- Raw sample persisted before it is processed; a failed write is never counted (docs/05 §10).
- No distance across a segment boundary: gap > `maxGapMs` (20 000) on either clock, hidden page, pause, watcher restart, clock reset (docs/05 §3.4–3.5).
- Thresholds (configurable, docs/05): accuracy 30 m; outlier WALK 12 / BICYCLE 65 / MOTORBIKE 150 / CAR 180 km/h; stop 2 km/h, dwell 15 s, radius 20 m; smoothing window 3; quality GOOD ≥90 % & median accuracy ≤25 m & ≤2 large gaps, FAIR ≥70 %, else LOW.
- `unknownMs = elapsed − paused − moving − stopped` (≥ 0); test `elapsed ≈ paused + moving + stopped + unknown` within 1 ms (GPS-010).
- `coveragePct = 100 × (moving + stopped) / (elapsed − paused)`, `null` when denominator ≤ 0.
- `minSpeedKmh = 0` only with a confirmed stop; else min positive smoothed moving speed; else `null`. `maxSpeedKmh` from median-3 smoothed edges, only with ≥ 3 edges.
- Only `src/data/**` imports Dexie; components never touch storage; Zustand never holds points.
- No migration may delete or rewrite existing user data; schema changes go through `db.version(n).upgrade()` with a test.
- A trip is never COMPLETED without a valid start fix; finalize failure keeps the track (SRS §6).

## Decisions needing maintainer confirmation (defaults used by this plan)

| # | Decision | Default in this plan |
|---|---|---|
| D1 | `[tripId+sourceSeq]` unique? (docs/04 §3 says unique, §6 schema lacks `&`) | Unique: `&[tripId+sourceSeq]` |
| D2 | Event ordering vs points (docs/03 wants source/recorded ts per event; docs/04 one `timestamp`) | Keep one app-clock `timestamp`; add additive field `seq` shared with `gpsPoints.sourceSeq` (one per-trip counter) |
| D3 | Trip that never got a valid fix (SRS §6 vs 00 §0.2) | Keep SRS: cancel deletes it; recovery offers “Hủy” for such trips |
| D4 | Analytics fields nullable (docs/04 says `number`) | `number \| null` (= not computable); update docs/04 |
| R1 | `endedAt` when ending a trip recovered after reload | Last persisted activity (max of point `recordedAt`, event `timestamp`, trip checkpoint), never the reopen time; `isIncomplete = true` |
| R2 | Pause | Stops the GPS watch (battery); RESUME opens a new segment |

## Review Focus

1. Reload while the page had been hidden for a long time → recovery adds no distance or time across the closed period, and `elapsedMs` is not inflated by the reopen time.
2. Second tab opened while a hidden tab still records → second tab is read-only, shows “đang ghi ở tab khác”, never offers recovery for that trip.
3. IndexedDB quota error mid-trip → storage error shown, previously committed points survive reload, finalize retry works.
4. 10 000-point trip → `analyzeTrip` < 500 ms in Vitest/jsdom; End never leaves the UI stuck in FINALIZING (timeout).
5. Pause while STARTING (not allowed), End while PAUSED, page hidden while PAUSED → pause time stays PAUSED, never UNKNOWN or MOVING.

---

## File structure

| File | Responsibility |
|---|---|
| `src/data/db.ts` | `RouteTrackDb` Dexie class, schema v1 |
| `src/data/repositories/DexieTripRepository.ts` | `TripRepository` over Dexie (transactions) |
| `src/data/repositories/liveQueries.ts` | `useLiveTrips`, `useLiveTripDetail` (dexie-react-hooks) |
| `src/data/locks/LeaseRecorderLock.ts` | IndexedDB lease + BroadcastChannel fallback lock |
| `src/adapters/locks/WebLocksRecorderLock.ts` | `navigator.locks` implementation |
| `src/domain/geo/trackProcessor.ts` | + OUTLIER gate, drift anchor, PAUSE/RESUME boundaries |
| `src/domain/analytics/classify.ts` | edge classification MOVING/STOPPED/UNKNOWN (dwell clusters) |
| `src/domain/analytics/analyzeTrip.ts` | replay + partition + speeds + coverage + quality |
| `src/domain/trip/TrackingController.ts` | pause/resume, seq counter, checkpoints, finalize via analytics, recovery, lock |
| `src/domain/ports.ts` | + `RecorderLock`, `TripRepository.listActiveTrips()` |
| `src/components/tracking/RecoveryNotice.tsx` | recovery UX |
| `docs/04-DATA-MODEL.md`, `README.md` | data contract + status |

---

### Task 1: Dexie schema + repository (RT-201)

**Files:** Create `src/data/db.ts`, `src/data/repositories/DexieTripRepository.ts`, `src/data/repositories/DexieTripRepository.test.ts`; Modify `src/domain/models/types.ts` (`TripEvent.seq: number`), `src/domain/ports.ts`, `src/data/repositories/InMemoryTripRepository.ts` (keep as test double), `package.json`.

**Interfaces — Produces:**
- `class RouteTrackDb extends Dexie` with tables `trips`, `gpsPoints`, `tripEvents`, `routeGroups`, `recorderLease`; `version(1).stores({ trips: 'id, startedAt, status, transportMode, routeGroupId, updatedAt', gpsPoints: 'id, tripId, &[tripId+sourceSeq], [tripId+sourceTimestamp]', tripEvents: 'id, tripId, [tripId+seq], [tripId+timestamp], type', routeGroups: 'id, name', recorderLease: 'name' })`.
- `new DexieTripRepository(db: RouteTrackDb)` implements `TripRepository`; port gains `listActiveTrips(): Promise<Trip[]>` (status ∉ {COMPLETED}).
- `listEvents` orders by `[tripId+seq]`.

- [ ] Write tests (fake-indexeddb, a fresh db name per test): `create/get/update round-trips a trip`; `appendRawPoint is idempotent for the same id`; `rejects a second point with the same [tripId+sourceSeq]`; `recordProcessingResult updates only processing fields`; `deleteTripCascade removes trip, points and events atomically` (abort mid-transaction by throwing inside → nothing deleted); `listActiveTrips returns only non-COMPLETED trips`; `listEvents follows seq even when timestamps tie`; `reopening the database keeps all rows` (close + new instance).
- [ ] Run: `npx vitest run src/data` → FAIL (module missing).
- [ ] Implement; `deleteTripCascade` uses `db.transaction('rw', [trips, gpsPoints, tripEvents], …)`.
- [ ] Run tests → PASS; run `npm run typecheck`.
- [ ] Commit `feat(data): Dexie schema v1 and TripRepository (RT-201)`.

### Task 2: One per-trip sequence for points and events (replay order)

**Files:** Modify `TrackingController.ts`, its test; `InMemoryTripRepository.ts` (sort events by `seq`).

**Interfaces — Produces:** controller field `nextSeq()` shared by `GpsPoint.sourceSeq` and `TripEvent.seq`; every boundary (PAGE_HIDDEN, PAGE_VISIBLE, PAUSE, RESUME, RECOVERY/restart) is an event with `seq` assigned **when it arrives**, so replay order = arrival order.

- [ ] Test `events and points share one strictly increasing sequence in arrival order` (hidden between samples 3 and 4 → PAGE_HIDDEN.seq is between their sourceSeq).
- [ ] FAIL → implement → PASS → commit.

### Task 3: OUTLIER gate and drift filter (RT-203; GPS-002, GPS-006)

**Files:** Modify `trackProcessor.ts`, `gpsConfig.ts` (`drift: { minStepM: 2, uncertaintyFactor: 1 }`), tests.

**Interfaces — Produces:** `createTrackProcessor(config, { startedAt, transportMode })`; state `distanceAnchor: AcceptedFix | null`.
- Outlier: only for a candidate edge in the open segment: `max(0, d − accA − accB) / dt × 3.6 > outlierSpeedKmh[mode]` → reject `OUTLIER` (not the ordering anchor). A rejected run cannot block forever: once the app has received nothing accepted for > `maxGapMs`, the next fix opens a new segment.
- Drift: distance is added from `distanceAnchor` to the new fix only when `d ≥ max(minStepM, uncertaintyFactor × √(accAnchor² + accFix²))`, then the anchor moves; otherwise nothing is added (residual dropped at segment end).

- [ ] Tests: `GPS-002 STATIONARY 5 min jitter ≤ 4 m (accuracy 8 m) → distance < 5 m`; `STRAIGHT 5 m/s distance within 1 % of Haversine sum`; `GPS-006 1 km jump in 2 s is OUTLIER and the next normal fix joins the segment`; `outlier speed limit depends on transport mode (WALK rejects 20 km/h, CAR accepts it)`; `a persistent jump opens a new segment after maxGap instead of rejecting forever`.
- [ ] FAIL → implement → PASS (whole suite) → commit.

### Task 4: Pause / Resume (RT-205; GPS-004)

**Files:** `trackProcessor.ts` (`PAUSE`/`RESUME` boundaries, reason `AFTER_PAUSE`), `stateMachine.ts` (already has PAUSE/RESUME), `TrackingController.ts` (`pause()`, `resume()`), `TrackingPage.tsx` (buttons “Tạm dừng” / “Tiếp tục”, status “Tạm dừng”), tests.

**Interfaces — Produces:** `controller.pause(): Promise<void>` (RECORDING only; stops watch; event PAUSE), `controller.resume(): Promise<void>` (PAUSED only; event RESUME; boundary; restart watch).

- [ ] Tests: processor `GPS-004 pause 120 s → no distance across, new segment AFTER_PAUSE`; controller `pause stops the watch and logs PAUSE`, `resume restarts it and the next fix opens a new segment`, `pause is ignored while STARTING`, `End while PAUSED completes`; page `Tạm dừng / Tiếp tục buttons switch state`.
- [ ] FAIL → implement → PASS → commit.

### Task 5: Analytics engine (RT-204, RT-207; GPS-009/010/011, docs/05 §5–§8)

**Files:** Create `src/domain/analytics/classify.ts`, `src/domain/analytics/analyzeTrip.ts`, tests `analyzeTrip.test.ts`; fixtures in `src/tests/fixtures/gpsFixtures.ts`.

**Interfaces — Produces:**
- `analyzeTrip(input: { trip: Trip; points: readonly GpsPoint[]; events: readonly TripEvent[]; endedAt: number; config: GpsConfig }): TripMetrics`
- `TripMetrics = { distanceMeasuredM; elapsedMs; pausedMs; movingMs; stoppedMs; unknownMs; avgElapsedKmh; avgMovingKmh; maxSpeedKmh; minSpeedKmh; p95SpeedKmh; coveragePct; qualityLabel; isIncomplete; acceptedCount; rawCount; segmentCount; largeGapCount; medianAccuracyM; start: LatLng | null; end: LatLng | null; reprocessed: readonly PointProcessingResult[] }` (all metric numbers `number | null` where docs allow).
- Replay: merge points (by `sourceSeq`) and boundary events (by `seq`), fold `processSample`/`applyBoundary`.
- Classification per edge: inside a cluster that stays within `max(stop.radiusM, accuracy)` of its first fix for ≥ `stop.dwellMs` → STOPPED; else smoothed speed (provider `speedMps` if present, else derived; median-3) ≥ `stop.speedKmh` → MOVING; else UNKNOWN.
- Paused intervals from PAUSE→RESUME (or →End); edges clipped to `[startedAt, endedAt]`.

- [ ] Tests: `GPS-010 elapsed = moving + stopped + paused + unknown ± 1 ms` (straight + stop + pause + gap fixture); `GPS-009 no confirmed stop → minSpeed is the smallest moving speed, not 0`; `a 30 s stop is STOPPED and minSpeed = 0`; `a 10 s slow-down stays UNKNOWN`; `GPS-011 40 % active time missing → coverage ≈ 60 %, LOW`; `GPS-003 90 s gap adds ~90 s to unknownMs`; `maxSpeed ignores a single raw spike`; `null coverage when elapsed − paused ≤ 0`; `replay of persisted points reproduces the live distance and segments`; `10 000 points analysed in < 500 ms`.
- [ ] FAIL → implement → PASS → commit.

### Task 6: Finalize from analytics, checkpoints, finalize timeout (RT-205)

**Files:** `TrackingController.ts`, `tripFactory.ts` (→ `applyMetrics(trip, metrics, endedAt)`), `gpsConfig.ts` (`checkpointMs: 15_000`, `finalizeTimeoutMs: 10_000`), `METRICS_VERSION = 1`, tests.

- [ ] Tests: `End stores analyzeTrip metrics with metricsVersion 1`; `trip row is checkpointed (updatedAt, distance) every 15 s and when the page hides`; `a finalize that hangs > 10 s goes INTERRUPTED/FINALIZE_FAILED and keeps all points`.
- [ ] FAIL → implement → PASS → commit.

### Task 7: Recovery after reload (RT-205, FR-12, UC-08, AC-05; BROWSER_RELOAD)

**Files:** `TrackingController.ts` (`findRecoverable()`, `resumeRecovered(id)`, `endRecovered(id)`, `discardRecovered(id)`), `src/components/tracking/RecoveryNotice.tsx`, `HomePage.tsx`, `HistoryPage.tsx`, `TrackingPage.tsx`, tests.

**Interfaces — Produces:** `findRecoverable(): Promise<Trip | null>` (active trip in DB while no tab holds the lock); resume replays points/events into processor + render track, continues `seq` from the stored max, logs `RECOVERY {reason:'RELOAD'}`, applies `WATCH_RESTART`; `endRecovered` ends at last persisted activity (R1); `discardRecovered` only for trips without a start fix (D3).

- [ ] Tests: `BROWSER_RELOAD: resumed trip continues in a new segment with no distance across the closed period`; `seq continues after the stored maximum`; `endRecovered uses the last persisted activity as endedAt and marks incomplete`; `a STARTING trip without fix can only be discarded`; page `Home shows the recovery notice with Tiếp tục ghi / Kết thúc`.
- [ ] FAIL → implement → PASS → commit.

### Task 8: One recorder across tabs (RT-206, FR-13, AC-07)

**Files:** `src/domain/ports.ts` (`RecorderLock`), `src/adapters/locks/WebLocksRecorderLock.ts`, `src/data/locks/LeaseRecorderLock.ts`, `TrackingController.ts`, `HomePage.tsx`, `TrackingPage.tsx`, tests.

**Interfaces — Produces:** `interface RecorderLock { acquire(): Promise<boolean>; release(): Promise<void>; heldElsewhere(): Promise<boolean>; onChange(listener: () => void): Unsubscribe }`. Web Locks: `navigator.locks.request('routetrack-recorder', { ifAvailable: true }, …)` held until release; fallback lease row `{ name, ownerId, expiresAt }` renewed every 5 s, TTL 15 s, changes announced on `BroadcastChannel('routetrack')`.

- [ ] Tests: `start() fails with RECORDER_BUSY when another tab holds the lock (no trip row created)`; `lock is released on End and on cancel`; `lease expires 15 s after the owner stops renewing`; page `Start disabled with “Đang ghi ở tab khác”`.
- [ ] FAIL → implement → PASS → commit.

### Task 9: Wire Dexie in the app, live queries, E2E

**Files:** `src/app/services.ts`, `src/hooks/useTrips.ts` → `src/data/repositories/liveQueries.ts`, remove M1 memory-only notices, `e2e/persistence.spec.ts`, `e2e/tracking.spec.ts`.

- [ ] E2E: `AC-05 reload keeps the completed trip in History and Detail`; `reload during recording shows recovery; resume makes a new segment`; `AC-07 second tab cannot start while the first records`; `AC-03 pause/resume/end summary`; `AC-09 simulated quota error shows the storage error and keeps earlier points` (stub `IDBObjectStore.add` to throw after N writes).
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build && npm run e2e` → all PASS → commit.

### Task 10: Docs and report

**Files:** `docs/04-DATA-MODEL.md` (D1, D2, D4, `recorderLease`), `docs/05-GPS-ALGORITHMS.md` (clock model, drift and outlier parameters as implemented), `docs/07-TEST-PLAN.md` (mark GPS-001…011 covered), `README.md` (status, limits, field-test items for M2).

- [ ] Update docs; run `npm run format:check`; commit `docs: M2 data contract and test traceability`.
