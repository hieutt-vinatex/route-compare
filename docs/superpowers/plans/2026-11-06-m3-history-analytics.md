# M3 — History, Trip Detail & analytics UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recorded trips usable after the fact: searchable/filterable History, a full Trip Detail (multi-segment map from replay, stats with units and formulas, speed timeline with unknown/paused bands, quality/incomplete warnings), and rename/delete.

**Architecture:** No new storage tables. Detail recomputes `analyzeTrip()` (pure, docs/05) from the persisted raw points + events and renders from that single result (map, stats, chart) — fixing M2 minor M10. History filtering is a pure function over `listTrips()`; filter state lives in the URL query. Chart.js is lazy-loaded (ADR-09) and fed by a pure, tested series builder; no date adapter or annotation plugin.

**Tech Stack:** + `chart.js` ^4.6.1, `react-chartjs-2` ^5.3.1 (peer React 19 OK) — ADR-09, already in the approved stack.

**Spec:** `docs/02-SRS.md` (FR-08, FR-09, FR-10, FR-14, FR-15, NFR-09), `docs/05-GPS-ALGORITHMS.md` §5–§8, `docs/06-UI-UX.md` §4–§5, `docs/07-TEST-PLAN.md` (AC-08), `docs/08-ROADMAP.md` (RT-301…RT-304), M2 deferred minors M10/M16.

## Global Constraints

- Units: domain m, ms, m/s; UI km/m, km/h, “x phút y giây”. Missing → “—”, never 0; 0 km/h only for confirmed STOPPED (BR-07).
- Label distance as **“Quãng đường GPS đo được”** everywhere (BR-06); incomplete trips always show the warning (FR-10).
- LOW quality copy (docs/06 §4): “GPS thiếu dữ liệu trong X phút; quãng đường hiển thị chỉ là phần đã đo được.” (X = unknown minutes, ≥ 1).
- Components read/write only through `TripRepository` hooks; no Dexie in components; Zustand never holds points.
- Rename/delete only for `COMPLETED` trips; an active/unfinished trip is resolved via the recovery notice (BR-01).
- Delete = one transaction over trip + points + events (exists: `deleteTripCascade`) behind a confirm dialog (FR-14).
- Chart: UNKNOWN intervals are shaded and plotted as line breaks (`null`), never as 0; ≤ 600 plotted points.
- Mobile 360/390 px without horizontal scroll; buttons ≥ 44 px; colour never the only signal.
- Production CSP stays strict (no `unsafe-inline`); E2E asserts zero CSP violations on Detail with the chart.

## Decisions needing maintainer confirmation (defaults used by this plan)

| # | Decision | Default |
|---|---|---|
| Q1 | Where History filters live | URL query (`?q=&mode=&from=&to=&status=`) — survives back/refresh, nothing persisted |
| Q2 | Delete trips in M3 (roadmap RT-405 lists it in M4; test plan says M3/M4) | Yes, in M3 with confirm; backup/export stays M4 |
| Q3 | Speed chart x-axis | Minutes since start (linear axis, no date adapter) |
| Q4 | Search | Case- and diacritics-insensitive (“ha noi” finds “Hà Nội”) |

## Review Focus

1. History while an unfinished trip exists → its row shows “Chưa kết thúc” with “—” values and the recovery notice stays visible whatever the filters.
2. Date filter at local midnight (Asia/Ho_Chi_Minh): a trip starting 23:30 local belongs to that local day, not the next UTC day.
3. Detail of a trip with 0–2 accepted fixes or no classified edges → chart area says “Chưa đủ dữ liệu tốc độ”, no 0 km/h line.
4. Rename/delete attempted for a trip that is recording (this or another tab) → refused, data untouched.
5. 10 000-point trip → Detail analysis + series < 500 ms in Vitest, chart ≤ 600 points.

---

## File structure

| File | Responsibility |
|---|---|
| `src/domain/analytics/analyzeTrip.ts` | + `paused: Interval[]` in `TripMetrics` (additive) |
| `src/domain/analytics/speedSeries.ts` | pure `buildSpeedSeries()` (points + bands, bucketing) |
| `src/domain/ports.ts`, `src/data/repositories/*` | + `renameTrip(id, name)` |
| `src/app/historyFilter.ts` | pure `filterTrips()`, `normalizeSearch()`, URL ⇄ filter |
| `src/hooks/useTrips.ts` | `useTripDetail` reloads points only when `trip.updatedAt` changes (M16) |
| `src/hooks/useTripAnalysis.ts` | memoised `analyzeTrip` for a loaded detail |
| `src/components/trip/SpeedChart.tsx` (+ `LazySpeedChart.tsx`) | Chart.js line + band plugin |
| `src/components/trip/TripStats.tsx`, `FormulaNotes.tsx`, `TripActions.tsx` | stats grid, “Cách tính”, rename/delete |
| `src/pages/HistoryPage.tsx`, `src/pages/TripDetailPage.tsx` | pages |
| `e2e/history.spec.ts` | search/filter, detail chart, rename, delete (AC-08) |

---

### Task 1: Speed series for the chart (RT-303)

**Files:** Create `src/domain/analytics/speedSeries.ts`, `speedSeries.test.ts`; Modify `analyzeTrip.ts` (+ `paused`), `analyzeTrip.test.ts`.

**Interfaces — Produces:**
- `TripMetrics.paused: readonly Interval[]` (app clock, clipped to the trip).
- `buildSpeedSeries(metrics: TripMetrics, startedAt: number, maxPoints = 600): SpeedSeries` with `SpeedSeries = { points: { tMin: number; kmh: number | null }[]; bands: { fromMin: number; toMin: number; kind: 'UNKNOWN' | 'PAUSED' }[]; hasData: boolean }`. A point per edge end (`edge.to`) with `kmh = speedMps × 3.6` or `null` when `speedMps === null` or `cls === 'UNKNOWN'`; a `null` point is inserted at every segment boundary and inside each band so the line never bridges a gap. Above `maxPoints`, equal-time buckets take the mean of their non-null values (`null` if none). Bands = `metrics.unmeasured` → UNKNOWN, `metrics.paused` → PAUSED. `hasData` = at least 2 non-null points.

- [ ] Tests: `paused intervals are reported`; `an UNKNOWN edge is a line break, never 0`; `a confirmed stop plots 0`; `a gap between segments breaks the line and is an UNKNOWN band`; `a pause is a PAUSED band, not UNKNOWN`; `10 000 edges → ≤ 600 points, peaks preserved within the bucket mean`; `fewer than 2 speeds → hasData false`.
- [ ] FAIL → implement → PASS → commit `feat(analytics): speed series for the trip chart (RT-303)`.

### Task 2: History search and filters (RT-301, FR-09)

**Files:** Create `src/app/historyFilter.ts`, `historyFilter.test.ts`; Modify `src/pages/HistoryPage.tsx`, `src/pages/pages.test.tsx`, `src/app/copy.ts`.

**Interfaces — Produces:** `HistoryFilter = { q: string; mode: TransportMode | 'ALL'; from: string | null; to: string | null; status: 'ALL' | 'COMPLETE' | 'INCOMPLETE' | 'UNFINISHED' }` (`from`/`to` = `yyyy-mm-dd` local dates); `normalizeSearch(s)` (NFD, strip marks, `đ→d`, lower-case, collapse spaces); `filterTrips(trips, filter, timeZone)`; `filterFromParams(URLSearchParams)` / `filterToParams(filter)`.

- [ ] Unit tests: `“ha noi” matches “Hà Nội đi làm”`; `mode filter`; `from/to are inclusive local days (23:30 Asia/Ho_Chi_Minh stays on its day)`; `status COMPLETE / INCOMPLETE / UNFINISHED`; `params round-trip, unknown values fall back to ALL`.
- [ ] Page tests: `search narrows the list and survives a re-render from the URL`; `“Không có hành trình khớp bộ lọc” + “Xóa bộ lọc”`; `an unfinished trip row shows “Chưa kết thúc” and “—” values`; row shows date/time, mode, duration, distance, coverage, quality pill (text, not colour only).
- [ ] FAIL → implement (controls: search input, mode select, two date inputs, status select; list newest first) → PASS → commit.

### Task 3: Trip Detail from one analysis (RT-302, RT-304, FR-10; M10, M16)

**Files:** Create `src/hooks/useTripAnalysis.ts`, `src/components/trip/TripStats.tsx`, `src/components/trip/FormulaNotes.tsx`; Modify `src/hooks/useTrips.ts`, `src/pages/TripDetailPage.tsx`, `src/app/copy.ts`, tests in `src/pages/pages.test.tsx`, `src/hooks/useTrips.test.tsx` (new).

**Interfaces — Produces:** `useTripAnalysis(detail: TripDetailData): { metrics: TripMetrics; segments: LatLng[][] } | null` (null until COMPLETED); segments come from the replayed accepted fixes, so map, counts and stats share one source. `useTripDetail` re-reads points/events only when `trip.updatedAt` or `trip.status` changes.

- [ ] Tests: `detail map segments equal the replay segments (stored live flags ignored)`; `active trip: a new sample alone does not re-read points; a checkpoint does` (M16); `LOW trip shows “GPS thiếu dữ liệu trong 3 phút; …”`; `every stat shows its unit and “—” when null`; `“Cách tính” lists the docs/05 formulas (distance, elapsed partition, avg toàn chuyến = distance/(elapsed − paused), avg khi di chuyển, coverage)`; `incomplete reasons still listed`.
- [ ] FAIL → implement → PASS → commit.

### Task 4: Speed chart (RT-303, NFR-09)

**Files:** Modify `package.json`/lockfile (`chart.js`, `react-chartjs-2`); Create `src/components/trip/SpeedChart.tsx`, `LazySpeedChart.tsx`, `SpeedChart.test.tsx`; Modify `TripDetailPage.tsx`.

**Interfaces — Consumes:** `buildSpeedSeries` (Task 1), `useTripAnalysis` (Task 3). **Produces:** `<LazySpeedChart series={SpeedSeries} />` — `React.lazy` chunk registering only `LineController, LineElement, PointElement, LinearScale, Tooltip`; inline plugin `bandsPlugin` fills bands behind the line (UNKNOWN grey hatch, PAUSED light blue) and a text legend below the canvas; `spanGaps: false`, `animation` off when `prefers-reduced-motion`; `aria-label` summary (“Tốc độ theo thời gian; cao nhất …; x phút không xác định”).

- [ ] Tests (react-chartjs-2 mocked to capture props): `null speeds stay null in the dataset`; `bands reach the plugin options`; `hasData false → “Chưa đủ dữ liệu tốc độ”, no chart`; `the chart chunk is not in the main bundle` (build manifest check in Task 6 E2E).
- [ ] FAIL → implement → PASS → commit.

### Task 5: Rename and delete (FR-10 actions, FR-14, AC-08)

**Files:** Modify `src/domain/ports.ts`, `src/data/repositories/DexieTripRepository.ts` (+ test), `InMemoryTripRepository.ts`; Create `src/components/trip/TripActions.tsx`; Modify `TripDetailPage.tsx`, page tests.

**Interfaces — Produces:** `TripRepository.renameTrip(id: string, name: string): Promise<void>` — trims; 1–120 chars; only when `status === 'COMPLETED'` (else throws `TripNotEditableError`); updates `name` + `updatedAt` only (Dexie `update`, no full-row overwrite). Delete reuses `deleteTripCascade`, UI-gated to COMPLETED.

- [ ] Tests: `renameTrip changes only name/updatedAt`; `renameTrip refuses an active trip`; `rename trims and rejects empty`; page: `rename via dialog updates heading and History`; `delete asks to confirm, removes trip + points + events, returns to History`; `no rename/delete buttons for an unfinished trip`.
- [ ] FAIL → implement → PASS → commit.

### Task 6: E2E, docs, report

**Files:** Create `e2e/history.spec.ts`; Modify `README.md`, `docs/07-TEST-PLAN.md` (§7 rows RT-301…304, AC-08), `docs/06-UI-UX.md` only if copy changed.

- [ ] E2E (simulated GPS, 360/390/1280): record 2 trips (WALK, MOTORBIKE) → History search + mode filter; Detail shows chart `canvas`, UNKNOWN legend, “Cách tính”; zero CSP violations; rename; delete with confirm → gone after reload (AC-08).
- [ ] Gates: `npm run typecheck && npm run lint && npm run format:check && npm run test && npm run build && npm run e2e`.
- [ ] Report per AGENTS.md (requirement IDs, files, tests, mock vs device, risks).
