# 03. Kiến trúc kỹ thuật và triển khai

## 1. Sơ đồ khối

```
[React SPA / PWA: Home, Tracking, History, Detail, Compare]
            |      |       |
         Zustand  Hooks  View components
            |      |
     [Trip Use Cases / GPS Controller / Analytics Engine]
            |        |                 |
    [TripRepository] [BrowserAdapter] [Geo/Stats pure functions]
            |        |
      [Dexie/IDB]  [Geolocation + Visibility + WakeLock]
            |
    [PWA app shell cache / export + backup]
            |
  [Cloudflare Pages: static hosting over HTTPS]
```

Chỉ có **một web app**; không có backend, WS, queue hoặc server database trong MVP. IndexDB là source-of-truth; Zustand chỉ lưu trạng thái UI và dữ liệu ngắn hạn.

## 2. Technology selection

- **React + TypeScript + Vite:** SPA, type safety, fast development.
- **React Router:** 5 routes (`/`, `/tracking`, `/history`, `/trips/:id`, `/compare`).
- **Tailwind CSS:** mobile-first UI, dark/light optional, CSS tokens.
- **Zustand:** active UI view state; không lưu lịch sử GPS trong Zustand.
- **Geolocation Web API:** `watchPosition` với enableHighAccuracy; không có API callback interval bảo đảm.
- **Page Visibility + Screen Wake Lock:** optional giữ màn hình sáng; không ghi native background.
- **Leaflet + React Leaflet:** vẽ nhiều polyline theo segment và marker của điểm đầu/cuối.
- **Dexie + IndexedDB:** transactions, indexes, migrations, storage local.
- **Chart.js + react-chartjs-2:** biểu đồ lịch sử tốc độ; lazy-load.
- **vite-plugin-pwa:** cache app shell, asset revisioning, installability; service worker không lấy GPS.
- **Vitest/React Testing Library/Playwright:** unit, component, E2E mock GPS.
- **Cloudflare Pages:** kết nối Git, `npm run build`, output `dist`, HTTPS.

**Không chốt số major hardcode**: Coding agent kiểm tra trang chính thức, chọn phiên bản stable tương thích và cố định lockfile. Không tự thêm native SDK.

## 3. Project folder

```
routetrack-web/
  public/icons/
  src/
    app/                # router, app shell, provider
    pages/              # Home, Tracking, History, TripDetail, Compare
    components/         # map/, tracking/, analytics/, ui/
    domain/
      models/           # types, validation schemas
      trip/             # state machine, use cases
      geo/              # Haversine, GPS point filter, segments
      analytics/        # speeds, durations, comparisons, coverage
    adapters/
      geolocation/      # BrowserGeolocationAdapter
      wake-lock/        # ScreenWakeLockAdapter
      visibility/       # PageVisibilityAdapter
    data/
      db.ts             # Dexie schema + migration
      repositories/     # Trip, GpsPoint, Event, RouteGroup
      import-export/    # GPX/CSV/JSON
    stores/             # Zustand UI state only
    hooks/              # React hooks, useLiveQuery wrappers
    styles/
    tests/              # fixtures and pure function tests
  e2e/
  docs/                # the spec
  AGENTS.md
  CLAUDE.md
  vite.config.ts
  package-lock.json
```

## 4. Services/interfaces bắt buộc

```ts
export interface GeolocationAdapter {
  getCurrentPosition(): Promise<RawGpsSample>;
  startWatch(onSample: (s: RawGpsSample) => void, onError: (e: GpsError) => void): Promise<void>;
  stopWatch(): void;
}

export interface TripRepository {
  create(trip: Trip): Promise<void>;
  appendRawPoint(point: RawGpsSampleEntity): Promise<void>;
  appendEvent(event: TripEvent): Promise<void>;
  updateTrip(trip: Trip): Promise<void>;
  getTrip(id: string): Promise<Trip | undefined>;
  listTrips(filter?: TripFilter): Promise<Trip[]>;
  deleteTripCascade(id: string): Promise<void>;
}

export interface AnalyticsEngine {
  analyze(points: RawGpsSampleEntity[], events: TripEvent[], trip: Trip): TripMetrics;
}
```

TypeScript interface minh họa hợp đồng; cần triển khai type cụ thể ở models. Nên có `Clock` và `IdGenerator` injectable để replay tests không phụ thuộc thời gian thật.

## 5. Luồng nhận điểm GPS

```
watchPosition callback
  -> validate type/range, normalize timestamp/units
  -> write RAW sample to IndexedDB
  -> use filter: duplicates, stale, accuracy, time order, speed outlier
  -> decide accepted/rejected + gap/segment
  -> persist processing result and state/events
  -> recompute incremental metrics in domain service
  -> throttle UI redraw (không throttle raw persistence)
```

Một lỗi async write không được silently swallowed. Nếu persist raw thất bại: báo ‘đang có nguy cơ mất dữ liệu’, cho phép End + Export khi dữ liệu còn, không tiếp tục hiển thị trạng thái an toàn giả.

## 6. Resilience và multi-tab

- Dùng `navigator.locks` khi browser hỗ trợ hoặc lease tại IndexedDB (mốc hết hạn + heartbeat) và BroadcastChannel thông báo các tab.
- Khi refresh, ID trip ở IDB, lần mở mới cần hỏi khôi phục/hoàn tất; **lần mở mới không tái tạo dữ liệu GPS trong khi tab bị đóng**.
- Quản lý listener lifecycle idempotent; không tạo duplicate watcher do React Strict Mode.
- Mỗi event có UUID, `source_ts` và `recorded_at` UTC để audit.

## 7. PWA, offline và nguồn tile

- PWA cache HTML/JS/CSS/icon và cho mở phần UI/lịch sử offline sau lần tải đầu.
- Không tự động tải hàng loạt map tile; không xây nút ‘Tải khu vực offline’ trên server tile OSM công cộng.
- Nguồn tile là cấu hình chuyển đổi; hiển thị attribution rõ. Offline có thể chỉ thấy track trên nền trống nếu chưa có tile hợp lệ.
- Cân nhắc request persistent storage, nhắc backup; không coi IndexedDB là lưu trữ vĩnh viễn.

## 8. Security & privacy

- HTTPS production, CSP phù hợp nguồn bản đồ, tránh nhúng script lạ. Triển khai: `deploy/securityHeaders.ts` sinh `dist/_headers` khi build và cấp header cho `vite preview` (E2E). `connect-src 'self'` (mã trang không gửi được dữ liệu ra origin khác), `img-src` chỉ origin tile suy ra từ `VITE_TILE_URL` (bắt buộc https), không `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, `Permissions-Policy` giới hạn geolocation/wake lock cho origin app, `Referrer-Policy: strict-origin-when-cross-origin` (OSM yêu cầu Referer).
- Quyền GPS theo thao tác của người dùng; có màn hình giải thích việc thu thập vị trí.
- Không upload GPS, không Google Analytics riêng tư mặc định, không lưu API key bí mật trong Vite env (public bundle).
- Cẩn trọng với các tile/traffic provider: việc tải tile có thể tiết lộ vùng bản đồ người dùng xem; nêu trong privacy note.
- Xuất GPX/CSV/JSON chỉ khi user bấm; hỗ trợ cắt đoạn nhạy cảm (P1).

## 9. CI/CD cơ bản

Workflow GitHub Actions (`.github/workflows/ci.yml`): checkout → `npm ci` → typecheck → lint → format → test → build → Playwright E2E → deploy bằng Wrangler khi push `main` và mọi kiểm tra đều đạt. Project Cloudflare Pages `routetrack` dùng Direct Upload, output `dist` đã kiểm thử, production tại <https://routetrack-d29.pages.dev>. Token Account → Cloudflare Pages → Edit nằm trong repository secret `CLOUDFLARE_API_TOKEN`, chỉ truyền cho bước deploy. PR chỉ chạy CI; chưa có preview tự động. Cấu hình `VITE_*` phải có trong môi trường build GitHub Actions, không lấy từ Pages Variables.

## 10. Architecture Decision Records

- ADR-13: Không Next.js vì không SSR/server-side business.
- ADR-14: Không PostgreSQL/Redis/Node backend trong MVP.
- ADR-15: Không sử dụng Mapbox/Google Maps SDK ban đầu để không phát sinh phí và phụ thuộc sớm.
- ADR-16: Tính analytics từ dữ liệu local, có thể tái xử lý khi thuật toán thay đổi; lưu `metrics_version` trong Trip.
