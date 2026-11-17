# M4 and M5 completion plan

**Goal** Complete the remaining web-only comparison, export privacy, storage and PWA requirements and deploy verified code.

**Architecture** Extend existing pure domain logic, repository ports and browser adapters. Preserve IndexedDB schema v1, GPS algorithms and existing exports by default.

**Spec** `docs/02-SRS.md` FR-11, FR-18 through FR-23, section 8, `docs/05-GPS-ALGORITHMS.md`, `docs/07-TEST-PLAN.md`, `docs/08-ROADMAP.md`.

## Implementation decisions

- Reuse `routeVariantLabel`, allow editing or clearing it on completed trips through an atomic repository field update.
- Show all time and speed metrics in a horizontally scrollable comparison table. Keep overlays limited to four trips. Calculate per-variant distributions over the complete selected A→B group, with mode, local date and configurable time-window warnings. Show sample count and population standard deviation. Descriptive median/P90 need three samples. Any stable-trend qualification needs five per variant across three local dates and sufficient quality, without inferring traffic causes.
- Add an export privacy radius in metres, default zero. Apply it to GPX/CSV only. JSON remains a full backup and the UI explains this. Remove every raw sample inside either endpoint circle, including rejected fixes, split retained runs at every removed point and preserve original segment boundaries. Never modify stored data or disclose removed coordinates in metadata.
- Put persistent-storage requests behind a user action in History, handle unsupported/denied/error states, and retain JSON backup guidance.
- Add raster PWA icons and an Apple touch icon from the existing artwork. Test actual Service Worker installation and offline history recovery with saved data.
- Preserve current production deployment and credentials. Field testing on real phones remains explicitly pending until performed.

## Tasks and files

- [x] Comparison domain/UI/tests in `src/domain/compare/compare*`, `src/pages/ComparePage*`, new `e2e/compare.spec.ts`.
- [x] Route variant edits in repository port/implementations, `useTripActions`, `TripActions`, repository/component/E2E tests.
- [x] Privacy export in `src/domain/export`, `useTripExport`, `TripActions`, regression tests for endpoints, gaps, rejected fixes, zero radius and empty output.
- [x] Browser storage adapter, History data-transfer storage UI/tests, PWA assets/config, actual offline E2E and accessibility checks.
- [x] Update SRS implementation definitions, acceptance matrix, roadmap and README. Record reproducible QA evidence and pending real-device checks.
- [x] Run `npm ci`, typecheck, lint, format check, unit tests, build, Playwright at 360/390px and review changes.
- [ ] Commit, push, watch CI/deploy and verify production. See the matching commit's Actions run for deployment evidence.

## Review focus

Old data with null variants remains readable. Editing one metadata field cannot overwrite another tab's update. Missing speeds stay null. Export privacy must cover rejected points and prevent new bridge segments. Unsupported browser storage APIs cannot block tracking. PWA updates must not interrupt a recording. No coordinates leave the device except deliberate downloads and normal map tile requests.
