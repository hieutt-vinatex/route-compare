# 08. Backlog, milestones và quy trình bàn giao AI Coding Agent

## Lộ trình triển khai theo năng lực sử dụng được

| Milestone | Nội dung | Deliverables | Exit criteria |
|---|---|---|---|
| M0 | Repo + foundation + docs | Vite React TS, Tailwind, Router, lint/test/build, docs | `npm ci`, build/test/lint/typecheck pass |
| M1 | GPS POC + live tracking | watchPosition adapter, basic map, Start/End, permission UI | Mock GPS chạy end-to-end; nhãn giới hạn background hiển thị |
| M2 | GPS reliability + local data | Dexie schema, service, filter, segments/gaps, pause/resume, recovery | Unit GPS-001→010 + refresh/offline không mất dữ liệu đã lưu |
| M3 | History/detail/analytics | History, detail route, duration/speed/quality, charts | Test nghiệp vụ và UI, warning incomplete rõ |
| M4 | Compare + grouping + export | Compare map, differences, group/variant, GPX/CSV/JSON | 2–4 trips, data coverage và warnings, export chuẩn |
| M5 | PWA + QA + deploy | SW cache app shell, icons, Lighthouse checks, Cloudflare Pages, QA reports | Deploy HTTPS, field test tối thiểu 1 Android + iOS nếu có |
| M6 (optional) | Traffic/cloud | Proxy/API provider, PostGIS migration | Bắt buộc có approval và đánh giá phí/điều khoản |

## Chi tiết backlog M0

- RT-001: Setup React + TS + Vite, Tailwind, ESLint, Vitest, Playwright; cập nhật README.
- RT-002: Router 5 routes + layout mobile-first + empty/loading/error screens.
- RT-003: Domain models/enums/types, config from `docs/05-GPS-ALGORITHMS.md`, Zod on import.
- RT-004: GitHub Actions `npm ci, lint, typecheck, test, build`; không đưa secrets vào repo.

## M1 — GPS Proof of Concept

- RT-101: `BrowserGeolocationAdapter` với `getCurrentPosition`, `watchPosition`, `clearWatch`, errors, user permission.
- RT-102: `TrackingPage` start/end, accurate status pill, Leaflet map segments.
- RT-103: Detect `visibilitychange` và wake lock optional; UI copy không hứa tracking nền.
- RT-104: Fixture-based mock GPS cho E2E (browser không cần GPS thật).

## M2 — Độ tin cậy dữ liệu

- RT-201: Dexie schema/typed repositories/migration tests.
- RT-202: State machine, `TripService`, persisted events.
- RT-203: GPS samples raw append và filter accuracy/duplicate/outlier.
- RT-204: Gap detection + multi-segment + durations partition.
- RT-205: Pause/resume/finalize/rescue interrupted.
- RT-206: Multi-tab guard (Web Locks + fallback BroadcastChannel/lease).
- RT-207: Haversine, speed, quality calculation (unit tests).

## M3 — Analytics / History

- RT-301: History filter/list, trip detail page.
- RT-302: Statistics cards with explicit units/formulas.
- RT-303: Chart.js speed timeline with unknown intervals.
- RT-304: Label/incomplete warnings + refactor rendering if large dataset.

## M4 — So sánh và xuất dữ liệu

- RT-401: Group matching same direction within 150m, mode filter, manual route variant.
- RT-402: Comparison overlay map and table; warnings on LOW coverage/non-comparable mode.
- RT-403: Median/P90 only with sufficient repeated samples (P1).
- RT-404: Export/Import JSON schema version, CSV/GPX segments.
- RT-405: Delete cascade, backup reminder, optional trim start/end of exported track.

## M5 — Production readiness

- RT-501: PWA manifest + SW only app-shell caching; do not prefetch OSM tiles.
- RT-502: Accessibility/visual QA (360px to desktop), no in-motion interaction.
- RT-503: Docs and privacy/limitations screens, source attributions.
- RT-504: Cloudflare Pages deployment, HTTPS/SPA fallback; preview/prod deploy.
- RT-505: Field testing + results (devices, browsers, GPS coverage, battery observations).

## Quy trình làm việc với Codex/Claude Code

1. **Read-first:** đọc toàn bộ docs có liên quan và AGENTS.md.
2. **Plan-first:** viết kế hoạch task + file changes + test cases trước khi sửa code.
3. **Small changes:** mỗi lần làm một milestone nhỏ, tránh trộn backend/native.
4. **TDD GPS math:** viết unit tests theo replay fixtures trước khi triển khai filters.
5. **Run gates:** `npm run typecheck && npm run lint && npm run test && npm run build`.
6. **Review:** xem diff, không tự thêm deps/API keys hoặc phá schema local.
7. **Update documentation:** nếu thay business rule, cập nhật BRD/SRS/AGENTS, changelog.
8. **Report:** agent báo rõ hoàn thành, limitations, test results, TODO, rủi ro.

## Phạm vi có thể bàn giao ngay

Ưu tiên chạy **M0 + M1 trước**. Nếu GPS hoạt động tốt khi trang hiển thị trên thiết bị thật, mới đầu tư M2–M5. Kiến trúc tách adapter cho phép sau này dùng nguồn GPS file GPX và backend sync; không được giả lập native background khi chọn web-only.
