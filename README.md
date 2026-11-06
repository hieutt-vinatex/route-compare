# RouteTrack Web

PWA **web-only, mobile-first, local-first** để ghi và so sánh hành trình GPS thực tế ngay trên trình duyệt. Không backend, không đăng nhập, dữ liệu vị trí không rời thiết bị.

**Đặc tả:** v2.1 (05/11/2026) · **Trạng thái code:** ✅ M0 · M1 · M2 (IndexedDB, lọc GPS, analytics, tạm dừng, khôi phục, khóa một tab) · ⏳ M3–M5 chưa làm — xem [Trạng thái milestone](#trạng-thái-milestone).

> ## ⚠️ Giới hạn nền tảng — không thương lượng
>
> **Trình duyệt không bảo đảm tiếp tục cung cấp điểm GPS khi khóa màn hình hoặc chuyển sang ứng dụng/tab khác.** Theo W3C Geolocation, cập nhật vị trí chỉ dành cho trang đang hoạt động và hiển thị; Service Worker **không** lấy GPS chạy nền.
>
> - RouteTrack ghi liên tục **chỉ khi trang đang hiển thị**. Khoảng trang bị ẩn được đánh dấu **“không đo được” (UNKNOWN)**, tách thành đoạn GPS mới và **không** cộng đường thẳng nối qua khoảng đó.
> - **Screen Wake Lock** (tùy chọn “Giữ màn hình sáng”) chỉ giữ màn hình sáng khi trang đang mở và hệ thống cho phép; nó **không** phải chế độ chạy nền và bị trình duyệt tự nhả khi trang bị ẩn.
> - Thời gian Start→End vẫn được đo đầy đủ; quãng đường chỉ là **“quãng đường GPS đo được”**.
> - Nếu cần ghi GPS khi khóa màn hình, đó là yêu cầu **ngoài phạm vi web-only** (cần app native) — không giải quyết bằng thủ thuật JavaScript.

## Yêu cầu

- Node.js **≥ 22.22** (React Router 8 yêu cầu; xem `.nvmrc`) và npm.
- Geolocation chỉ chạy trong **secure context**: `https://…` hoặc `http://localhost`.

## Bắt đầu

```bash
npm ci
npm run dev            # http://localhost:5173
```

| Lệnh | Mô tả |
|---|---|
| `npm run typecheck` | `tsc -b` (strict, app + config + e2e) |
| `npm run lint` | ESLint type-aware, `--max-warnings 0`, có rule kiến trúc |
| `npm run format:check` | Prettier |
| `npm run test` | Vitest: unit + replay GPS + component (jsdom) |
| `npm run build` | Build tĩnh vào `dist/` |
| `npm run e2e:install` | Tải Chromium cho Playwright (một lần) |
| `npm run e2e` | Playwright trên bản build, viewport 360/390/1280, **GPS mô phỏng** |

CI (`.github/workflows/ci.yml`): `npm ci → typecheck → lint → format:check → test → build → e2e`.

### Demo không cần GPS (chỉ khi dev)

Mở `http://localhost:5173/?gps=demo`: dùng tuyến đi bộ **tổng hợp** phát 1 điểm/giây. Ứng dụng hiện banner tím **“GPS GIẢ LẬP”**. Chế độ này bị vô hiệu trong bản build production và không bao giờ được dùng làm bằng chứng đo thực tế.

### Thử trên điện thoại thật

Vì GPS cần HTTPS, chọn một trong các cách:

1. **Android + Chrome (khuyên dùng khi dev):** cắm USB, bật USB debugging, mở `chrome://inspect/#devices` trên máy tính → *Port forwarding* `5173 → localhost:5173`. Trên điện thoại mở `http://localhost:5173` (được coi là secure context).
2. **Bản deploy HTTPS** (Cloudflare Pages preview — xem [Deploy](#deploy)).
3. `npm run dev -- --host` rồi truy cập qua IP LAN **không** dùng được GPS (không phải HTTPS) — app sẽ hiển thị “Tính năng GPS yêu cầu website chạy qua HTTPS.”

## Kiến trúc

```
src/
  domain/          Pure TypeScript — KHÔNG React/DOM/IndexedDB (ESLint chặn)
    models/        Types, enum, GPS_CONFIG (ngưỡng heuristic từ docs/05)
    geo/           haversine, trackProcessor (đồng hồ, lọc, drift, outlier, cắt segment), segments
    trip/          stateMachine, TrackingController (pause/resume, checkpoint, recovery), tripFactory
    analytics/     replay (dữ liệu thô → processor), classify (MOVING/STOPPED/UNKNOWN), analyzeTrip
    ports.ts       GeolocationAdapter, VisibilityAdapter, WakeLockAdapter, RecorderLock, TripRepository…
  adapters/        Nơi DUY NHẤT chạm navigator.geolocation / wakeLock / locks + bản Mock
  data/            db.ts (Dexie schema v1), repositories/ (Dexie; InMemory chỉ cho test), locks/ (lease)
  app/             composition root (services.ts), router, layout, copy tiếng Việt, format
  hooks/ stores/   React hooks; Zustand chỉ giữ tùy chọn UI (không giữ điểm GPS)
  components/ pages/  UI mobile-first (Tailwind), bản đồ Leaflet lazy-load
e2e/               Playwright + mock Geolocation/Permissions/Visibility
```

Luồng một mẫu GPS: `watchPosition` → chuẩn hóa đơn vị → **hàng đợi tuần tự** → **ghi RAW trước** → mô hình độ lệch đồng hồ (median của `recordedAt − timestamp` 5 mẫu gần nhất; mẫu đầu tiên của chuyến chỉ để hiệu chỉnh) → lọc (RANGE/TIMESTAMP/DUPLICATE/UNTRUSTED/STALE/ACCURACY) → cắt segment (gap > 20 s trên **một trong hai** đồng hồ, trang ẩn/hiện, khởi động lại watcher, đồng hồ bị chỉnh) → cộng Haversine **chỉ trong cùng segment** → ghi kết quả xử lý → UI cập nhật theo nhịp 1 s (không render mỗi callback). Sự kiện trang ẩn/hiện đi cùng hàng đợi nên thứ tự luôn đúng.

`TrackingController` được tạo **một lần ngoài React** (`main.tsx`) nên StrictMode không thể tạo watcher trùng; adapter Geolocation cũng idempotent.

**IndexedDB là nguồn sự thật.** Điểm và sự kiện dùng chung **một bộ đếm `seq` theo chuyến**, nên khi Kết thúc, `analyzeTrip()` *phát lại* toàn bộ dữ liệu thô đã lưu qua cùng bộ xử lý để tính số liệu cuối (`metricsVersion = 1`) — có thể tính lại khi thuật toán đổi (ADR-16). Trong lúc ghi, tiến độ được checkpoint mỗi 15 s và khi trang bị ẩn.

**Khôi phục sau tải lại/đóng tab (FR-12):** Trang chủ/Lịch sử hiện “Có hành trình chưa kết thúc” với *Tiếp tục ghi (đoạn mới)* — phát lại dữ liệu, bắt đầu đoạn mới, **không** suy diễn gì cho khoảng app bị đóng — hoặc *Kết thúc (chưa đầy đủ)* với giờ kết thúc = hoạt động cuối đã lưu. Chuyến chưa có điểm GPS hợp lệ chỉ có thể Hủy.

**Một tab ghi (FR-13):** khóa `navigator.locks` (dự phòng: lease trong IndexedDB + BroadcastChannel). Tab thứ hai không bắt đầu được và không “khôi phục” chuyến đang được tab khác ghi.

## Trạng thái milestone

| Mốc | Trạng thái | Nội dung |
|---|---|---|
| **M0** | ✅ | Vite + React 19 + TS 6 strict, Tailwind 4, React Router 8 (5 route + 404), ESLint/Prettier, Vitest, Playwright, CI, domain models + `GPS_CONFIG` |
| **M1** | ✅ | Browser Geolocation adapter (idempotent, mock), Home có trạng thái quyền/vị trí, Tracking (Start/Hủy/Kết thúc có xác nhận, bản đồ nhiều segment, trạng thái tín hiệu, offline), Page Visibility + Wake Lock tùy chọn, hidden→gap không nối, Trip Detail tối thiểu |
| **M2** | ✅ | Dexie/IndexedDB (schema v1, giao dịch, test migration), mô hình độ lệch đồng hồ, lọc OUTLIER + drift, phân loại MOVING/STOPPED/UNKNOWN, phân hoạch thời gian, coverage + nhãn chất lượng, Tạm dừng/Tiếp tục, checkpoint + timeout khi lưu, khôi phục sau reload, khóa một tab. GPS-001…011 |
| M3 | ⏳ | Lịch sử (tìm/lọc), chi tiết đầy đủ, biểu đồ tốc độ, nhãn chất lượng |
| M4 | ⏳ | So sánh 2–4 chuyến, nhóm A→B, route variant, xuất GPX/CSV/JSON |
| M5 | ⏳ | PWA app-shell cache, Cloudflare Pages, QA & field test |

### Giới hạn đã biết sau M2

- Mọi ngưỡng (độ chính xác 30 m, gap 20 s, dung sai đồng hồ 5 s, drift, outlier, dừng 2 km/h/15 s/20 m) là **heuristic chưa hiệu chỉnh thực địa**.
- Mẫu GPS đầu tiên của mỗi chuyến chỉ để hiệu chỉnh đồng hồ (mất ~1 s đầu).
- Trong ~3 s đầu mỗi đoạn, “tốc độ hiện tại” có thể bị một điểm nhiễu kéo lên.
- Di chuyển rất chậm (< 2 km/h) trong bán kính 20 m quá 15 s có thể bị tính là “dừng”.
- Khi thiết bị không báo `coords.speed`, một lần dừng ngắn hơn 15 s có thể được tính như di chuyển chậm (không bao giờ là “dừng”).
- Bộ lọc nhiễu tính quãng đường theo “bước neo”: đường cong gắt với độ chính xác 15–30 m bị **đánh giá thấp** (ví dụ mô phỏng đường bậc thang: đo 299 m / thực 419 m).
- Trên trình duyệt không có Web Locks (iOS < 15.4) khóa một-tab dùng lease 15 s; tab bị ẩn lâu có thể mất quyền ghi cho tab khác và sẽ tự dừng ghi khi phát hiện.
- Lịch sử (tìm/lọc), biểu đồ (M3) và So sánh/Xuất dữ liệu (M4) chưa làm; trang Chi tiết đã hiện đủ số liệu docs/05 nhưng giao diện còn tối giản.
- IndexedDB có thể bị trình duyệt xóa (xóa dữ liệu site, chế độ riêng tư); sao lưu JSON đến ở M4.

## Kiểm thử

- **Unit/replay** (`src/**/*.test.ts`): GPS-001…011 (bảng truy vết ở `docs/07-TEST-PLAN.md` §7), **CLOCK_ERROR** (đồng hồ lệch cố định, fix “ở tương lai”, giao trễ, đồng hồ bị chỉnh, độ trễ trôi dần), bất biến “không cộng quãng đường qua ranh giới đoạn” với replay ngẫu nhiên có seed, “phát lại = live”. GPS-012 (nhóm A→B) thuộc M4.
- **Repository** (fake-indexeddb): CRUD, unique `[tripId+sourceSeq]`, xóa cascade nguyên tử, mở lại DB, mẫu nâng cấp schema giữ dữ liệu.
- **Controller**: ghi RAW trước, ghi storage lệch thứ tự (đã kiểm bằng mutation test), lỗi quota, thu hồi quyền, tạm dừng/tiếp tục, checkpoint, timeout khi lưu, khôi phục sau reload, khóa một tab, Wake Lock.
- **E2E (Playwright)**: chạy code adapter thật với **GPS giả lập** và đồng hồ trang được điều khiển — quyền, ẩn/hiện → 2 đoạn không nối, giữ dữ liệu qua reload (AC-05), khôi phục + đoạn mới, tạm dừng (AC-03), hai tab (AC-07), bộ nhớ đầy (AC-09), chỉ request tới origin app và tile OSM.
- **Hiệu năng:** `analyzeTrip` 10 000 điểm ~100 ms (lần đầu) / ~40 ms (warm) trên máy phát triển.

> Kết quả Playwright là **mô phỏng**, không chứng minh hành vi GPS trên thiết bị thật.

### Checklist kiểm thử thực địa (chưa thực hiện)

An toàn: chỉ thao tác khi đã dừng hẳn; có thể dùng hành trình đi bộ.

| # | Kịch bản | Cần quan sát |
|---|---|---|
| T1 | Android Chrome, ngoài trời 15–30 phút, màn hình luôn mở | Số mẫu hợp lệ/nhận được, lý do bị loại (đặc biệt `STALE`/`TIMESTAMP` — dấu hiệu đồng hồ GPS lệch), quãng đường so với tham chiếu |
| T2 | Bật/tắt “Giữ màn hình sáng” | Có được cấp không; tự nhả khi ẩn và xin lại khi quay về |
| T3 | Chuyển tab / khóa màn hình 1–2 phút rồi quay lại | Cảnh báo “khoảng không đo”, đoạn GPS mới, không có đường nối |
| T4 | Tắt mạng khi đang ghi | Vẫn nhận điểm; bản đồ nền có thể trống |
| T5 | iPhone Safari (nếu có) | Như T1–T3; ghi riêng kết quả từng trình duyệt |
| T6 | Thu hồi quyền vị trí / tắt dịch vụ vị trí của OS giữa chuyến | Có lỗi code 1 → “Đã gián đoạn ghi”, hay watch im lặng → “Thiếu tín hiệu GPS” mãi? |
| T7 | Đồng hồ: chỉnh giờ máy ±1 phút và ±10 phút (tắt giờ tự động) | Chuyến không kẹt ở “Đang chờ GPS”; ghi lại số mẫu `STALE`/`TIMESTAMP` và độ lệch `recordedAt − timestamp` (chỉ bộ đếm, không log tọa độ) |
| T8 | Nhịp callback khi trang mở, bình thường và khi bật tiết kiệm pin | Nếu khoảng cách > 20 s thì mọi cạnh thành gap → hiệu chỉnh `maxGapMs` |
| T9 | Khóa màn hình, chuyển app/tab, Control Center (iOS), kéo thanh thông báo (Android) rồi quay lại | `visibilitychange` có bắn? Số mẫu `UNTRUSTED`; watch có chạy lại; iOS có hỏi lại quyền mỗi lần đăng ký lại watch không (ảnh hưởng an toàn) |
| T10 | Hầm/tầng hầm (TIMEOUT / POSITION_UNAVAILABLE) | Watch có tự giao điểm lại mà không cần đăng ký lại? |
| T11 | Thời gian đến fix đầu ≤ 30 m (phố hẹp, trong ô tô) | Tần suất STARTING > 60 s |
| T12 | Back/forward cache (rời trang rồi Back), Android tự hủy tab nền | Watch có chạy lại; mất dữ liệu ở M1 có được cảnh báo rõ |
| T13 | TalkBack/VoiceOver trên hộp thoại Kết thúc; thao tác một tay; chữ ngoài trời | Focus không bị giật; nút ≥ 44 px dễ bấm |
| T14 | Chế độ máy bay nhưng bật GPS | Vẫn có điểm; banner lỗi tile hiện đúng |
| T15 | Mở tab thứ hai khi đang ghi (kể cả khi tab đầu bị ẩn) | Tab hai báo “đang ghi ở tab khác”, không bắt đầu được, không đề nghị khôi phục |
| T16 | Đóng tab / để Android hủy tab nền khi đang ghi rồi mở lại | Có thông báo khôi phục; “Tiếp tục” tạo đoạn mới, không có đường nối; “Kết thúc” lấy giờ hoạt động cuối, không lấy giờ mở lại |
| T17 | Đứng yên 5 phút ngoài trời; đi bộ chậm | Quãng đường gần 0 khi đứng yên; đi chậm vẫn được cộng; thời gian “Dừng” chỉ xuất hiện sau ≥ 15 s |
| T18 | Tạm dừng 1–2 phút rồi tiếp tục | GPS tắt khi tạm dừng (biểu tượng vị trí của OS), “Tạm dừng” đúng thời lượng |
| T19 | Bộ nhớ gần đầy / chế độ riêng tư | Thông báo lỗi lưu trữ; điểm đã lưu còn sau khi mở lại |
| T20 | Chuyến 1–2 giờ (≥ 5 000 điểm) | Thời gian từ bấm Kết thúc đến trang Chi tiết; UI không giật |

Ghi kết quả như **quan sát**, không coi là SLA; không gộp kết quả của các trình duyệt khác nhau thành bảo đảm chung.

## Quyền riêng tư

- Không analytics, không tracking endpoint, không gửi tọa độ lên server; không log tọa độ.
- Bản đồ nền mặc định là **OpenStreetMap tiles** (có attribution, không prefetch/bulk download). Việc tải tile tiết lộ khu vực bạn đang xem cho nhà cung cấp bản đồ — được nêu trong UI.
- Có thể đổi nguồn tile qua `VITE_TILE_URL`/`VITE_TILE_ATTRIBUTION` (xem `.env.example`). **Không** đặt API key bí mật vào biến `VITE_*` — chúng nằm trong bundle công khai.

## Deploy

Cloudflare Pages (chi tiết hoàn thiện ở M5): build command `npm run build`, output `dist`, Node ≥ 22.22, production branch `main`. Pages tự phục vụ SPA fallback khi không có `404.html`.

## Tài liệu đặc tả

Nguồn sự thật nằm trong `docs/` — đọc trước khi sửa code (xem `AGENTS.md`, `CLAUDE.md`).

| Tệp | Nội dung |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | Quy tắc bắt buộc cho coding agent |
| `PROMPT_CODEX.md` / `PROMPT_CLAUDE_CODE.md` | Prompt triển khai theo mốc |
| `docs/00-DECISIONS.md` | Quyết định đã chốt, phạm vi |
| `docs/01-BRD.md` · `docs/02-SRS.md` | Nghiệp vụ, FR/NFR |
| `docs/03-ARCHITECTURE.md` · `docs/04-DATA-MODEL.md` | Kiến trúc, mô hình dữ liệu |
| `docs/05-GPS-ALGORITHMS.md` | Thuật toán GPS (business-critical) |
| `docs/06-UI-UX.md` · `docs/07-TEST-PLAN.md` · `docs/08-ROADMAP.md` | UI, kiểm thử, lộ trình |
| `docs/09-SCALING-AND-TRAFFIC.md` · `docs/10-REFERENCES.md` | Mở rộng sau MVP, nguồn tham chiếu |
