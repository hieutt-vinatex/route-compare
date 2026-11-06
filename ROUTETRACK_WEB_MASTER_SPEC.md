# ROUTETRACK WEB

## TÀI LIỆU ĐẶC TẢ NGHIỆP VỤ, KỸ THUẬT VÀ KẾ HOẠCH TRIỂN KHAI

**BRD · SRS · Solution Architecture · GPS/Data Rules · QA · AI Coding Agent Handoff**

**Phiên bản:** 2.1  
**Ngày phát hành:** 05/11/2026  
**Nền tảng:** Web Application / Progressive Web App (web-only)  
**Mục tiêu triển khai:** React + TypeScript + Vite + IndexedDB, mobile-first, offline-first.

> **Thông điệp nền tảng:** Geolocation trên trình duyệt không bảo đảm cập nhật GPS khi màn hình khóa hoặc trang bị ẩn. Ứng dụng phải đo trung thực, lưu thông tin thiếu mẫu và không tự cộng đường thẳng giữa hai vị trí qua khoảng mất tín hiệu.

### Thành phần trong tài liệu

1. Quyết định kiến trúc và công nghệ.
2. BRD — tổng hợp yêu cầu nghiệp vụ.
3. SRS — yêu cầu chức năng và phi chức năng.
4. Kiến trúc module, browser services và cách deploy.
5. Thiết kế dữ liệu IndexedDB.
6. Thuật toán GPS và quy tắc tính toán.
7. Đặc tả giao diện và luồng UX.
8. Test plan và tiêu chí nghiệm thu.
9. Roadmap, backlog và phương pháp giao việc cho AI.
10. Định hướng cloud, traffic API và scaling.
11. Nguồn tham chiếu chính thức.

**Tệp triển khai kèm theo:** bộ Markdown `AGENTS.md`, `CLAUDE.md`, `PROMPT_CODEX.md`, `PROMPT_CLAUDE_CODE.md` và các tài liệu độc lập trong thư mục `docs/`.

---


# 00. Quyết định sản phẩm và công nghệ (ADR Index)

**Trạng thái:** Approved for MVP · 05/11/2026.

## 0.1. Quyết định cuối cùng

| Mã | Quyết định | Lý do / hệ quả |
|---|---|---|
| ADR-01 | Web application / PWA thuần browser | Không build Android/iOS, truy cập bằng URL HTTPS |
| ADR-02 | React + TypeScript + Vite (SPA) | Nhẹ, thân thiện với coding agent, không cần SSR |
| ADR-03 | Tailwind CSS + React Router | Mobile-first và các trang rõ ràng |
| ADR-04 | Zustand chỉ giữ UI/active-trip state | IndexedDB là nguồn sự thật bền vững |
| ADR-05 | Geolocation `watchPosition()` | API browser tiêu chuẩn, bắt buộc HTTPS và quyền định vị |
| ADR-06 | `visibilitychange`, Page Lifecycle và optional Wake Lock | Nhận diện gián đoạn; Wake Lock không phải chạy nền |
| ADR-07 | Dexie + IndexedDB | Không cần backend; query, migration và transaction gọn |
| ADR-08 | Leaflet + React Leaflet | Vẽ track GPS nhiều đoạn, overlay so sánh |
| ADR-09 | Chart.js + react-chartjs-2 | Biểu đồ tốc độ và thống kê, lazy-load |
| ADR-10 | `vite-plugin-pwa` | Cache app shell, cài đặt; không ghi GPS ở service worker |
| ADR-11 | Cloudflare Pages | Hosting tĩnh HTTPS, deploy từ Git |
| ADR-12 | Backend/Traffic API ngoài MVP | Bảo vệ phạm vi và chi phí, chỉ thêm khi có bằng chứng nhu cầu |

**Quy tắc phiên bản:** Cài bản stable tương thích tại thời điểm triển khai, commit `package-lock.json`, dùng `npm ci` trong CI. Không tự đoán số phiên bản hay nâng major đồng loạt không kiểm thử. Cấm thêm framework backend hoặc SDK native khi chưa có yêu cầu được phê duyệt.

## 0.2. Giới hạn không thể “code workaround”

Theo đặc tả Geolocation hiện hành của W3C, cập nhật vị trí được dành cho tài liệu đang hoạt động/hiển thị. Khi khóa màn hình hoặc chuyển ứng dụng, browser có thể không phát cập nhật. PWA và Service Worker không biến ứng dụng thành native background service. Từ đó:

- Webapp hỗ trợ **ghi liên tục khi trang đang hoạt động**, không cam kết ở nền.
- Wake Lock được yêu cầu theo tương tác người dùng; thất bại phải có fallback và cảnh báo.
- Khu vực không đủ GPS mang trạng thái **UNKNOWN**, không phải STOPPED, không phải 0 km, không phải “đã đi đường thẳng”.
- Có thể **đo thời gian từ lúc Start đến End** ngay cả khi thiếu điểm GPS, nhưng quãng đường chỉ là phần đã ghi hợp lệ.

## 0.3. Những gì không thực hiện trong MVP

Đăng nhập, đa thiết bị, theo dõi người khác, map matching, định tuyến tối ưu, traffic API trả phí, real-time traffic history, geofencing, tự động ghi GPS khi khóa màn hình, native bridge, push notification nền, microservice, AI dự đoán tuyến đường.

## 0.4. Các ưu tiên nghiệp vụ

P0: ghi hành trình/hiển thị thực tế, bảo toàn dữ liệu, thông số đo có giải thích, so sánh 2 chuyến cùng A→B.  
P1: xuất dữ liệu, biểu đồ, nhóm tuyến, thống kê nhiều lượt, UX nâng cao.  
P2: traffic snapshots đúng thời điểm, sync cloud, quản trị nhiều người dùng.

## 0.5. Nguyên tắc an toàn khi di chuyển

Thiết kế để người dùng bấm bắt đầu/truy cập khi đã dừng an toàn; khi đang chạy xe chỉ hiển thị trạng thái không đòi hỏi tương tác. Không đưa cảnh báo yêu cầu thao tác giữa đường.


---


# 01. BRD — Business Requirements Document

## 1. Tầm nhìn và mục tiêu

RouteTrack Web ghi **hành trình đã thực sự di chuyển** bằng GPS trên browser và biến lịch sử đó thành báo cáo so sánh giữa các con đường khác nhau từ A đến B. Khác với ứng dụng chỉ tìm đường, RouteTrack trả lời *trong các lần đi thực tế, tuyến nào nhanh hơn, quãng đường nào ngắn hơn, sự ổn định theo khung giờ ra sao và dữ liệu có đủ tin cậy không?*

### Kết quả kinh doanh/người dùng

- Mỗi chuyến được lưu thành bản ghi có tọa độ, thời gian, phương tiện và chất lượng GPS.
- Người dùng nhìn thấy tuyến đã đi, số liệu quãng đường, thời gian và các vận tốc được định nghĩa rõ ràng.
- Có thể chọn 2+ chuyến, overlay các track khác nhau, so sánh kết quả đồng điều kiện.
- Nhận biết **các đoạn chính thiết bị di chuyển chậm**; không suy luận nguyên nhân giao thông nếu thiếu nguồn độc lập.
- Dữ liệu mặc định riêng tư trên thiết bị, không bắt người dùng tạo tài khoản.

## 2. Vai trò

**Người sử dụng:** chủ thiết bị, cấp quyền vị trí, tạo chuyến, đặt tên, so sánh, xuất/xóa dữ liệu.  
**Quản trị hệ thống:** chỉ cấu hình hosting; MVP không có tài khoản/quyền quản trị bên trong ứng dụng.  
**Browser/thiết bị:** nguồn dữ liệu GPS và chính sách hoạt động ở nền, chất lượng có thể thay đổi.

## 3. Luồng nghiệp vụ đầu cuối

1. Mở HTTPS/PWA → kiểm tra browser GPS và quyền, xem dấu vị trí hiện tại.
2. Chọn phương tiện `WALK`, `BICYCLE`, `MOTORBIKE`, `CAR`; có thể nhập tên A/B và tên tuyến thủ công.
3. Nhấn **Bắt đầu** → lấy mẫu GPS đầu đủ chất lượng → tạo bản ghi `RECORDING`.
4. Trong quá trình, nghe `watchPosition`; persist từng mẫu thô, xử lý/filter, hiển thị track và chỉ số.
5. Có thể **Tạm dừng**, **Tiếp tục**; lúc tạm dừng không cộng quãng đường.
6. Nếu trang bị ẩn, quyền thay đổi hoặc GPS gián đoạn: lưu event và mở đoạn UNKNOWN; khi quay lại tiếp tục bằng segment mới.
7. Nhấn **Kết thúc** → dừng watcher, chốt thời gian, lưu summary và hiển thị cảnh báo chất lượng.
8. Vào **Lịch sử** → xem lại, đổi tên, gắn nhóm A→B, xuất GPX/CSV/JSON hoặc xóa.
9. Vào **So sánh** → chọn các chuyến cùng hướng/cùng phương tiện/cùng khung giờ; xem overlay + bảng chỉ số và độ đầy đủ dữ liệu.

## 4. Use cases và tiêu chí kinh doanh

| UC | Tên | Tiền điều kiện | Kết quả |
|---|---|---|---|
| UC-01 | Bắt đầu chuyến | Có quyền GPS, HTTPS, chưa có chuyến active | `RECORDING`; có vị trí mở đầu hợp lệ |
| UC-02 | Ghi track | Browser còn hoạt động và nhận vị trí | Lưu mẫu kèm time/accuracy; vẽ polyline theo segment |
| UC-03 | Pause/Resume | Có chuyến RECORDING/PAUSED | Bảo toàn thời gian pause và không cộng quãng đường pause |
| UC-04 | Kết thúc | Có chuyến active | Summary + lịch sử + cờ chất lượng |
| UC-05 | Xem lại | Có bản ghi local | Mở bản đồ, số liệu, biểu đồ, event |
| UC-06 | So sánh | Có ít nhất 2 chuyến | Overlay, bảng chênh lệch, cảnh báo dữ liệu không tương đương |
| UC-07 | Export/Delete | Có chuyến local | Export hoặc xóa toàn bộ dữ liệu liên quan |
| UC-08 | Phục hồi | Refresh/crash khi chưa kết thúc | Hỏi phục hồi/kết thúc thiếu dữ liệu, không nối khoảng vắng GPS |

## 5. Quy tắc và nghiệp vụ bắt buộc

**BR-01. Một phiên đo:** trong cùng một thiết bị/origin, chỉ có một chuyến active; ngăn 2 tab đồng thời ghi bằng BroadcastChannel + lock/lease fallback.  
**BR-02. Người dùng chủ động:** quyền vị trí chỉ xin khi bắt đầu hoặc yêu cầu xem vị trí; không đo khi chưa được đồng ý.  
**BR-03. Dữ liệu thô:** lưu raw GPS trước/đồng thời với đánh giá hợp lệ; không xóa dữ liệu bị bác bỏ nếu người dùng còn giữ chuyến.  
**BR-04. Không ghép qua khoảng trống:** một chuyến có thể gồm nhiều segment; chỉ tính quãng đường nội segment hợp lệ.  
**BR-05. Thời gian:** `elapsed = end-start`; tách `paused`, `moving`, `stopped`, `unknown` không trùng lặp; `elapsed ≈ paused+moving+stopped+unknown` (có thể có thời gian khởi động được phân vào unknown).  
**BR-06. GPS chất lượng kém:** không hiện tổng quãng đường như giá trị chắc chắn; báo ‘quãng đường GPS đo được’, có coverage.  
**BR-07. Thấp nhất:** 0 km/h chỉ khi có trạng thái STOPPED được xác nhận; nếu không có dữ liệu đủ tin cậy, hiển thị `—`.  
**BR-08. Đối sánh hợp lý:** so sánh cùng phương tiện/hướng, cảnh báo khi điểm đầu/cuối khác xa hoặc một chuyến thiếu GPS.  
**BR-09. Đường khác nhau:** người dùng có thể gắn tên phương án đường (ví dụ ‘Qua đường X’) thủ công; cùng điểm A/B **không có nghĩa** cùng đường.  
**BR-10. Giao thông:** tốc độ thấp/đứng yên **không** tương đương bằng chứng ùn tắc; traffic bên ngoài thuộc P2.  
**BR-11. An toàn:** người dùng không cần bấm khi đang điều khiển phương tiện.  
**BR-12. Dữ liệu riêng tư:** không upload vị trí trong MVP; khi dùng bản đồ mạng, yêu cầu tile vẫn có thể tiết lộ khu vực viewport cho bên cung cấp.

## 6. Giá trị đo lường thành công MVP

- 100% chuyến đã được kết thúc đúng cách hiển thị được bản đồ những **đoạn đã đo** và báo cáo.
- Chuyến có gián đoạn thể hiện warning và UNKNOWN segment thay vì bù đường thẳng.
- Các tình huống refresh, offline, thay đổi quyền GPS không làm mất toàn bộ lịch sử đã commit.
- Các phép tính replay dataset cho kết quả đúng theo test oracle; so sánh hiển thị cả chất lượng GPS.
- Kiểm thử thực địa trên ít nhất một Android Chrome và một iPhone Safari nếu thiết bị có sẵn; không gộp kết quả browser khác nhau thành bảo đảm chung.

## 7. Ngoài phạm vi

Chỉ đường theo thời gian thực, dữ liệu giao thông lịch sử không thu thập trước, tracking kín người khác, background GPS được bảo đảm khi khóa màn hình, data cloud/multi-tenant, app Android/iOS native.


---


# 02. SRS — Software Requirements Specification

## 1. Định nghĩa và phạm vi

- **Trip:** một lần đo từ Start đến End, có thể có nhiều GPS segment.
- **GPS sample:** vị trí do browser trả về, kèm accuracy, timestamp, speed nếu có.
- **GPS segment:** dãy các sample hợp lệ, liên tục, có thể tính khoảng cách.
- **Gap:** khoảng thời gian/vị trí thiếu mẫu tin cậy, không được suy diễn thành đoạn đường.
- **Route group:** nhóm A→B theo vùng điểm đầu/cuối và chiều di chuyển.
- **Route variant:** tên phương án tuyến đường người dùng tự đặt; không tự đồng nhất bằng endpoints.
- **Travel mode:** WALK/BICYCLE/MOTORBIKE/CAR.
- **Traffic snapshot:** dữ liệu nhà cung cấp được ghi nhận tại một mốc thời gian (P2).

## 2. Chức năng P0 (phải có)

| ID | Yêu cầu chi tiết | Acceptance criteria |
|---|---|---|
| FR-01 | Home hiển thị khả năng GPS, trạng thái quyền và vị trí hiện tại | Có loading/success/denied/unavailable; HTTPS cảnh báo rõ |
| FR-02 | Chọn phương tiện và Start | Chỉ Start khi user chủ động và có ít nhất 1 vị trí đủ điều kiện |
| FR-03 | `watchPosition` theo dõi khi trang hoạt động | Lưu mẫu có source time, accuracy và monotonic sequence |
| FR-04 | Dùng Page Visibility API để đánh dấu hidden/visible | Lưu event; sau ngắt quãng chuyển sang segment mới |
| FR-05 | Pause/Resume/End | Chuyển trạng thái chuẩn; không cộng đoạn pause |
| FR-06 | Auto-save vào IndexedDB | Mỗi mẫu được commit sớm; lỗi quota hiện thông báo |
| FR-07 | Track đa segment trên Leaflet | Không vẽ polyline nối qua gap; tô/đánh dấu gap rõ |
| FR-08 | Tính distance, elapsed, moving/stopped/unknown/paused, speed | Tuân theo `05-GPS-ALGORITHMS.md` |
| FR-09 | History: list, search, filter theo date/mode | Load dữ liệu local không cần server |
| FR-10 | Trip Detail: polyline + stats + sự kiện GPS | Có nhãn ‘GPS đo được’ và cảnh báo nếu incomplete |
| FR-11 | Compare: chọn ≥2 trips, overlay và bảng | So sánh elapsed/distance/speeds/quality, cảnh báo không đồng điều kiện |
| FR-12 | Recovery: reload/crash, tab cũ đóng | Phục hồi metadata, tách segment; không giả vờ đã ghi trong khi app tắt |
| FR-13 | Single active trip trên mỗi origin/thiết bị | Không có hai tab cùng ghi đồng thời; có cảnh báo khi tranh quyền |
| FR-14 | Delete trips và dữ liệu liên quan | Xóa liên kết trong transaction, có confirm |
| FR-15 | Error handling permissions/storage/sensors | Không crash; thông báo tiếng Việt có hành động cụ thể |

## 3. Chức năng P1

| ID | Yêu cầu |
|---|---|
| FR-16 | Screen Wake Lock khi trang active, cho phép tắt, xử lý release/reacquire |
| FR-17 | Biểu đồ tốc độ theo thời gian, phân vùng unknown và các mốc dừng |
| FR-18 | Nhóm A→B tự gợi ý trong bán kính cấu hình 150m + cùng hướng |
| FR-19 | Đặt tên route variant thủ công (Đường A/Đường B) |
| FR-20 | Thống kê nhiều chuyến: median elapsed, P90 elapsed, độ biến thiên, sample size |
| FR-21 | Export CSV GPS, GPX segment, JSON backup; import JSON có validate/schema version |
| FR-22 | Xuất dữ liệu với khả năng ẩn đoạn đầu/cuối theo bán kính tùy chọn |
| FR-23 | Yêu cầu persistent storage qua `navigator.storage.persist()` nếu hỗ trợ; hiển thị trạng thái backup |

## 4. Chức năng P2 (ngoài MVP)

FR-24 Provider-agnostic traffic snapshots đúng thời điểm; FR-25 backend proxy + quota; FR-26 cloud sync; FR-27 đăng nhập; FR-28 PostGIS/route clustering nâng cao; FR-29 phân tích giao thông theo đoạn đường với map matching và nguồn third-party hợp pháp.

## 5. Non-functional requirements

| ID | Mô tả | Chứng minh |
|---|---|---|
| NFR-01 | Mobile-first, chiều rộng 360px trở lên | Playwright viewport 360/390/768/1280 |
| NFR-02 | HTTPS trên production | Kiểm tra browser secure context |
| NFR-03 | JS/TS strict, lint, format, test | `npm run typecheck/lint/test/build` |
| NFR-04 | Không bắt user tạo tài khoản | E2E không có login flow |
| NFR-05 | Offline-first data; app shell offline sau lần tải đầu | Test bật offline và xem lịch sử; không khẳng định tile offline |
| NFR-06 | Private by default; không auto upload GPS | Network inspection, không có tracking endpoint |
| NFR-07 | Dữ liệu IndexedDB có migration và backup | Tests migrate + import/export |
| NFR-08 | Không mất mẫu đã lưu khi refresh | Reload test / recover state |
| NFR-09 | UI không render full track tại mỗi callback | Nhóm batch render, memo/lazy modules |
| NFR-10 | Các quyền GPS bị từ chối có hướng xử lý | E2E mock error PERMISSION_DENIED |
| NFR-11 | Không hứa ghi GPS nền/khóa màn hình | Kiểm tra banner và tài liệu |
| NFR-12 | Dữ liệu nhạy cảm không xuất mặc định lên server | Kiểm thử network và quyền export |
| NFR-13 | Accessibility: nút đủ lớn, label rõ, trạng thái không phụ thuộc màu | Manual + automated checks |

## 6. State machine

```
IDLE --START--> STARTING --GPS_OK--> RECORDING
                  |             |--PAUSE--> PAUSED --RESUME--> RECORDING
                  |             |--END--> FINALIZING --> COMPLETED
                  |             |--FATAL_ERROR--> INTERRUPTED
                  |--ERROR--> IDLE
```

- `PAGE_HIDDEN`/`GPS_GAP` **không tự đồng nghĩa** với PAUSED hoặc END: trạng thái vẫn có thể là RECORDING, nhưng chất lượng mẫu chuyển UNKNOWN cho interval thiếu.
- `STARTING` phải có timeout UX; không tạo chuyến COMPLETE nếu không có điểm bắt đầu hợp lệ.
- `FINALIZING` là transaction lưu summary; nếu lỗi, giữ trip RECOVERABLE, không xóa track.
- `INTERRUPTED`: lỗi hệ thống không thể tiếp tục ghi; cần người dùng quyết định tiếp tục/hoàn tất chưa đầy đủ.

## 7. Quy tắc xử lý các trường hợp đặc biệt

| Tình huống | Hệ thống phải làm |
|---|---|
| Người dùng từ chối GPS | Hiển thị hướng cấp lại quyền, không bắt đầu |
| Accuracy quá thấp | Vẫn lưu raw, gắn reject reason, không cộng khoảng cách |
| Điểm đến sai thứ tự thời gian hoặc trùng | Bác bỏ đối với tính toán, giữ raw nếu cần forensic |
| Browser ngủ / tắt màn hình | Đánh dấu khoảng UNKNOWN khi phát hiện; không bù quãng đường |
| Máy đổi múi giờ hoặc đồng hồ | Lưu timestamp UTC; flag timestamp bất thường, kiểm thử thời gian |
| Quá nhiều điểm GPS | Lưu mẫu trong DB; chỉ decimate cho vẽ bản đồ/biểu đồ, không làm thay đổi nguồn thống kê |
| Nhiều tab | Một tab được lock; tab khác chỉ có quyền đọc và cảnh báo |
| Dung lượng lưu trữ hết | Báo lỗi rõ, cố gắng giữ dữ liệu đã commit; cho xuất backup |
| Mất Internet | Điểm GPS vẫn lưu khi page sống; tile mới có thể không tải |
| Xóa site data / private browsing | Không thể bảo đảm lưu vĩnh viễn; khuyến nghị export |

## 8. So sánh tuyến đường

Trong một báo cáo, hiển thị raw `elapsed` từ start đến end; quãng đường *GPS đo được*; `moving_time`, `stopped_time`, `unknown_time`, `paused_time`; average door-to-door; average moving; max/min đã lọc; `coverage` và `quality_label`.

**Guardrails:**
- Nếu route A cùng endpoints nhưng có biến thể đường khác, hiển thị overlay nhưng không coi là cùng một tuyến vật lý.
- Nếu 1 trip có coverage thấp, không tạo kết luận ‘tuyến A nhanh hơn’ dựa trên quãng đường như thể dữ liệu đầy đủ.
- Nếu khung giờ/ngày/phương tiện khác, hiển thị cảnh báo so sánh khác điều kiện.
- Cần tối thiểu 5 chuyến mỗi biến thể và tối thiểu 3 ngày khác nhau trước khi đưa nhận định xu hướng ổn định (ngưỡng sản phẩm mang tính heuristic, không phải kiểm định thống kê).

## 9. API ngoài phạm vi

MVP không có REST API. Giai đoạn sau chuẩn hóa interface `TripRepository`, `TrafficProvider` để bổ sung cloud mà không sửa sâu UI và thuật toán.


---


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

- HTTPS production, CSP phù hợp nguồn bản đồ, tránh nhúng script lạ.
- Quyền GPS theo thao tác của người dùng; có màn hình giải thích việc thu thập vị trí.
- Không upload GPS, không Google Analytics riêng tư mặc định, không lưu API key bí mật trong Vite env (public bundle).
- Cẩn trọng với các tile/traffic provider: việc tải tile có thể tiết lộ vùng bản đồ người dùng xem; nêu trong privacy note.
- Xuất GPX/CSV/JSON chỉ khi user bấm; hỗ trợ cắt đoạn nhạy cảm (P1).

## 9. CI/CD cơ bản

Workflow GitHub Actions: checkout → `npm ci` → `npm run typecheck` → `npm run lint` → `npm run test -- --run` → `npm run build` → e2e smoke khi môi trường hỗ trợ. Trên Cloudflare Pages: production branch `main`, build `npm run build`, output `dist`. Preview branch qua PR.

## 10. Architecture Decision Records

- ADR-13: Không Next.js vì không SSR/server-side business.
- ADR-14: Không PostgreSQL/Redis/Node backend trong MVP.
- ADR-15: Không sử dụng Mapbox/Google Maps SDK ban đầu để không phát sinh phí và phụ thuộc sớm.
- ADR-16: Tính analytics từ dữ liệu local, có thể tái xử lý khi thuật toán thay đổi; lưu `metrics_version` trong Trip.


---


# 04. Data model, IndexedDB và hợp đồng dữ liệu

## 1. Quy ước chung

- UUID v4 cho Trip, Point, Event, RouteGroup; `sourceSeq` tăng đơn điệu trong mỗi trip.
- Timestamps là **milliseconds since Unix epoch UTC**, hiển thị múi giờ thiết bị (`Asia/Bangkok` ở Việt Nam thường +07 nhưng không hardcode timezone vào dữ liệu).
- Khoảng cách dùng **m**, thời gian dùng **ms**, speed dùng **m/s** trong domain; UI chuyển sang km/h và km.
- Lat/lng là WGS84 decimal degrees. Không chuyển GPX `lat/lon` thành pixel map.
- Không dùng số 0 thay `null` khi speed thiếu.

## 2. Bảng/collection `trips`

| Trường | Type | Notes |
|---|---|---|
| id | string UUID | PK |
| name | string | Người dùng có thể đổi tên |
| transportMode | WALK/BICYCLE/MOTORBIKE/CAR | Required |
| routeGroupId | string/null | Index |
| routeVariantLabel | string/null | Tên tuyến do user gắn |
| status | IDLE/STARTING/RECORDING/PAUSED/FINALIZING/COMPLETED/INTERRUPTED | Active states do not include IDLE persisted |
| startedAt | number | UTC ms |
| endedAt | number/null | UTC ms |
| startLat/startLng | number/null | Tọa độ hợp lệ đầu |
| endLat/endLng | number/null | Tọa độ hợp lệ cuối |
| distanceMeasuredM | number | Tổng các đoạn GPS đã đo được |
| elapsedMs | number | Start→End |
| pausedMs | number | User pause |
| movingMs | number | Classified moving |
| stoppedMs | number | Classified stopped |
| unknownMs | number | Không có đủ GPS |
| avgElapsedKmh | number/null | Chỉ số door-to-door, distanceMeasured / elapsed |
| avgMovingKmh | number/null | Distance / moving time |
| maxSpeedKmh/minSpeedKmh | number/null | Sau filter/smoothing |
| coveragePct | number | % thời gian có dữ liệu hợp lệ |
| qualityLabel | GOOD/FAIR/LOW | Heuristic có version |
| isIncomplete | boolean | Có gap/thiếu mẫu lớn hoặc kết thúc bất thường |
| metricsVersion | number | Bật tính lại khi nâng thuật toán |
| createdAt/updatedAt | number | UTC ms |

## 3. Bảng `gpsPoints`

| Trường | Type | Notes |
|---|---|---|
| id | UUID | PK |
| tripId | UUID | Index |
| sourceSeq | number | Unique compound `[tripId+sourceSeq]` |
| sourceTimestamp | number | GeolocationPosition.timestamp |
| recordedAt | number | Khi callback đã nhận |
| latitude/longitude | number | Geographic point |
| accuracyM | number/null | Provider horizontal accuracy |
| speedMps | number/null | Provider speed |
| headingDeg | number/null | Provider heading |
| segmentId | number/null | Null nếu reject |
| accepted | boolean | Raw sample retained |
| rejectCode | enum/null | RANGE, TIMESTAMP, DUPLICATE, STALE, ACCURACY, OUTLIER, UNTRUSTED |
| derivedSpeedMps | number/null | Computed between consecutive accepted samples |

## 4. Bảng `tripEvents`

`id, tripId, timestamp, type, metadataJson`, type: `START, PAUSE, RESUME, END, GPS_GAP_BEGIN, GPS_GAP_END, GPS_ERROR, PAGE_HIDDEN, PAGE_VISIBLE, WAKELOCK_ACQUIRED, WAKELOCK_RELEASED, STORAGE_ERROR, RECOVERY`.

## 5. Bảng `routeGroups`

`id, name, originLat, originLng, destinationLat, destinationLng, radiusM(default 150), createdAt, updatedAt`. Chỉ nhóm cùng hướng A→B. Đường cụ thể phân biệt qua `routeVariantLabel` và overlay, không tự kết luận cùng variant.

## 6. Chỉ mục Dexie đề xuất

```ts
// Reference schema, adjust TS types in implementation.
db.version(1).stores({
  trips: 'id, startedAt, status, transportMode, routeGroupId, updatedAt',
  gpsPoints: 'id, tripId, [tripId+sourceSeq], [tripId+sourceTimestamp]',
  tripEvents: 'id, tripId, [tripId+timestamp], type',
  routeGroups: 'id, name'
});
```

Migrations thông qua `db.version(n).stores(...).upgrade(...)`. Unit test bằng fake-indexeddb hoặc IndexedDB test environment. Không thay schema phá dữ liệu người dùng khi nâng cấp.

## 7. Transaction và tính nhất quán

- Điểm thô được `add/put` theo giao dịch; cập nhật `sourceSeq` và trip progress idempotent.
- `deleteTripCascade` xóa Trip + all gpsPoints + all tripEvents trong một transaction.
- Không ghi 100% polyline JSON vào `trips` sau mỗi sample; dữ liệu chi tiết nằm ở `gpsPoints`.
- Summary có thể tái dựng bằng raw points + events, tính bằng `metricsVersion`.
- Trên kết thúc, freeze final stats sau khi xử lý hết async writes; tuyệt đối không xóa track khi failed finalize.

## 8. Import/Export

- JSON backup: `{ schemaVersion, exportedAt, appVersion, trips, gpsPoints, tripEvents, routeGroups }`; kiểm tra bằng Zod, không nhập file quá lớn không giới hạn mà không hỏi.
- CSV: một hàng mỗi point với `trip_id, timestamp_iso, lat, lng, accuracy_m, speed_mps, segment_id, accepted, reject_code`.
- GPX: `<trkseg>` riêng cho mỗi segment, không nối qua gap; thời điểm ISO8601 UTC; thuộc tính speed mở rộng nếu cần.
- P1 export bảo vệ riêng tư: chọn ẩn điểm trong bán kính X ở đầu/cuối hoặc chỉ xuất các đoạn ở giữa; thông báo dữ liệu đã được cắt bớt.
- Import phải chịu được version cũ, trùng UUID, sai định dạng; báo lỗi rõ và tránh ghi nửa chừng.

## 9. Dung lượng và retention

MVP không tự xóa chuyến. Hiển thị tổng số chuyến + dung lượng ước lượng; yêu cầu persistent storage khi được hỗ trợ (`navigator.storage.persist()`) nhưng không coi là bảo đảm. Người dùng có thể xóa site data; luôn có chức năng backup.


---


# 05. GPS Processing, distance, time, speed và chất lượng dữ liệu

**Đây là phần business-critical.** Mọi công thức phải có unit test và dữ liệu replay. Không tính toán metric chỉ bằng `coords.speed` hay tổng khoảng cách nối toàn bộ raw points.

## 1. Dữ liệu vị trí, đơn vị và API

- Call `navigator.geolocation.watchPosition(onSuccess, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })`. Đây là đề xuất ban đầu, không phải cam kết browser trả mẫu mỗi X giây.
- `GeolocationPosition.timestamp` là epoch ms; `coords.latitude`, `longitude` degrees WGS84; `accuracy` meters; `speed` meters/second hoặc `null`; `heading` có thể `null`.
- `maximumAge: 0` yêu cầu điểm mới khi có thể; browser vẫn phụ thuộc GPS/radio/OS. Các mức ngưỡng bên dưới là **heuristic configurable** để field test, không phải tiêu chuẩn độ chính xác tuyệt đối.
- `visibilitychange` & `pageshow/pagehide` được sử dụng để ghi event. Không phụ thuộc `beforeunload` để lưu dữ liệu cuối cùng.
- `Screen Wake Lock` yêu cầu khi user bật tùy chọn; giải phóng khi rời tracking/kết thúc; nếu được release tự động thì yêu cầu lại khi visible nếu user vẫn muốn.

## 2. Pipeline

```
Position callback
  -> normalize + raw persist
  -> check timestamp validity, bounds and duplicate
  -> accuracy gate / outlier gate (with reasons)
  -> detect time gap & visibility boundaries
  -> append accepted point into a segment (or start new segment)
  -> classify interval MOVING/STOPPED/UNKNOWN
  -> update stats from accepted segments + events
  -> update live UI on throttled schedule
```

**Critical:** Nếu callback nhận điểm thô nhưng write IndexedDB thất bại, không được coi dữ liệu đã an toàn. Hiển thị STORAGE_ERROR; cho phép user kết thúc và thử xuất bản sao tạm nếu có.

## 3. Điều kiện hợp lệ và filter

1. `lat ∈ [-90,90]`, `lon ∈ [-180,180]`, timestamp hữu hạn; `accuracy > 0` nếu provider cung cấp.
2. Không cộng điểm có timestamp không tăng hoặc trùng mẫu; lưu raw với `rejectCode`.
3. Mẫu có `accuracy > 30m` mặc định đánh dấu LOW_ACCURACY và có thể chờ mẫu tốt hơn; ngưỡng 30m cần cấu hình riêng theo mode/điều kiện thực tế.
4. Nếu `dt = sourceTimestamp[i]-sourceTimestamp[i-1] > 20s` mặc định: kết thúc segment trước, mở gap; mẫu mới bắt đầu segment sau, không cộng đoạn nối.
5. Nếu `visibilityState` chuyển sang hidden, đánh dấu boundary; khi visible lại, start segment mới dù khoảng gap nhỏ; không chốt rằng vẫn ghi GPS trong khi hidden.
6. Nếu dist/dt tạo speed cao bất thường, đánh dấu OUTLIER và đối chiếu accuracy, các mẫu lân cận. Ví dụ ngưỡng cảnh báo mặc định `WALK 12`, `BICYCLE 65`, `MOTORBIKE 150`, `CAR 180` km/h. Chúng là bộ lọc kỹ thuật khởi tạo, **không phải chỉ dẫn tốc độ an toàn/giới hạn pháp luật**; không áp dụng cứng cho mọi môi trường mà không hiệu chỉnh.
7. GPS drift khi đứng yên: dùng spatial radius/dwell và uncertainty để tránh tính nhiễu thành quãng đường. Không cộng các bước rất nhỏ so với độ chính xác.

## 4. Khoảng cách Haversine

Với hai vị trí được chấp nhận trong **cùng segment**:

```text
R = 6,371,000 meters
lat1,lat2,lon1,lon2 in radians
dLat = lat2 - lat1
dLon = lon2 - lon1
a = sin(dLat/2)^2 + cos(lat1)*cos(lat2)*sin(dLon/2)^2
dMeters = 2*R*atan2(sqrt(a), sqrt(1-a))
```

`distanceMeasuredM = sum(dMeters)` trên các cặp hợp lệ, liên tục, thuộc cùng segment và đã qua drift filter. Khoảng GPS gap có `distanceUnknown`, không phải distance=0, không phải straight-line bridge.

## 5. Phân hoạch thời gian

Gọi `tripElapsedMs = endedAt - startedAt`.

- `pausedMs`: hợp các interval user PAUSED; không chồng lặp.
- `knownMs`: interval giữa các GPS mẫu chấp nhận **trong cùng segment**, chưa pause và không vượt `maxGapMs`, đủ điều kiện phân loại.
- `movingMs`: phần `knownMs` được xác nhận chuyển động.
- `stoppedMs`: phần `knownMs` xác nhận đứng yên sau dwell.
- `unknownMs = tripElapsedMs - pausedMs - movingMs - stoppedMs` (giới hạn không âm); bao gồm khởi động, mất GPS, ẩn tab và interval không đủ chứng cứ.
- Bảo đảm `tripElapsedMs ≈ pausedMs + movingMs + stoppedMs + unknownMs` trong test (chấp nhận rounding ≤ 1 ms).

Một đoạn GPS có tốc độ tức thời thấp nhưng chưa đủ thời gian dwell phải được giữ UNKNOWN cho đến khi có xác nhận; không mặc định STOPPED. `elapsedMs` luôn tính từ timestamp Start→End, nên thời gian vẫn đo được ngay cả khi GPS thiếu.

## 6. Xác nhận dừng/di chuyển

Đề xuất bước đầu:

- Ngưỡng tốc độ thấp `2 km/h`, dwell tối thiểu `15 s`, dịch chuyển trong bán kính ~20 m đã điều chỉnh theo accuracy.
- Tổ hợp nhiều mẫu liên tiếp cần dùng để xác nhận STOPPED; khi speed `null`, dùng displacement/dt của accepted points.
- Không xem pause thủ công là stopped; pause nằm ở `pausedMs`.
- Nếu thiếu GPS, trạng thái là UNKNOWN, không khẳng định đang dừng hay chạy.

## 7. Công thức speed

- `vSegmentMps = distanceBetweenAcceptedPointsM / deltaSeconds`, chỉ khi `deltaSeconds > 0`, không gap.
- `avgElapsedKmh = distanceMeasuredM / elapsedSeconds * 3.6`, với elapsedSeconds > 0; nhãn UI **“TB theo toàn chuyến (dựa trên GPS đo được)”** nếu quality thấp.
- `avgMovingKmh = distanceMeasuredM / movingSeconds * 3.6` nếu movingSeconds > 0; trong thực tế distance khi stopped đã được loại drift.
- `maxSpeedKmh`: tốc độ lớn nhất của các interval hợp lệ sau median smoothing (e.g. cửa sổ 3); chỉ report khi sample count đủ và không bị nhiễu. Không dùng spike raw `coords.speed` duy nhất.
- `minSpeedKmh = 0` khi có stopped được xác nhận; nếu không có stopped, dùng min positive smoothed moving speed; nếu thiếu dữ liệu thì `null` (UI hiển thị `—`).
- Thêm optional `p95SpeedKmh` để giải thích outlier; không dùng tốc độ max duy nhất để kết luận về đường nhanh/chậm.

## 8. Data completeness / quality

`coveragePct = 100 * (movingMs + stoppedMs)/(elapsedMs - pausedMs)` khi denominator > 0, ngược lại `null`.

Quality label (heuristic phiên bản 1, cần field calibration):

| Level | Rule khởi tạo |
|---|---|
| GOOD | coverage ≥90%, median accepted accuracy ≤25m, ≤2 gaps lớn |
| FAIR | coverage ≥70% nhưng không đạt GOOD |
| LOW | Còn lại hoặc dữ liệu quá ít |

Không so sánh chất lượng trip chỉ bằng số điểm; tốc độ callback của browser không do app kiểm soát. Luôn hiển thị `coveragePct`, total gap seconds, accepted/raw point counts. `isIncomplete=true` khi bị gián đoạn lớn, thiếu start/end GPS, hoặc COMPLETED từ RECOVERY bất thường.

## 9. Điểm đầu/cuối, grouping và direction

- Dùng GPS accepted đầu và cuối (không dùng raw không hợp lệ).
- Gợi ý 2 trip cùng origin/destination khi distances giữa originA-originB và destA-destB không vượt 150m, đồng thời mode trùng; reverse B→A là nhóm khác.
- **Không** tự gắn cùng đường/variant chỉ vì cùng endpoints. Route variant thủ công trong MVP; phase sau dùng map matching + similarity.

## 10. Pseudocode quan trọng

```ts
async function onGpsSample(raw: RawGpsSample) {
  // 1. Persist raw before relying on the sample.
  await repository.appendRawPoint(raw);
  const result = filterSample(raw, previousAccepted, config);
  await repository.recordProcessingResult(raw.id, result);
  if (!result.accepted) return;

  const crossesBoundary = wasPageHidden || isPaused ||
    !previousAccepted ||
    raw.timestamp - previousAccepted.timestamp > config.maxGapMs;

  if (crossesBoundary) {
    await repository.startGpsSegment(tripId, raw.timestamp);
    await repository.appendEvent({ type: 'GPS_GAP_END', timestamp: raw.timestamp });
    previousAccepted = raw;
    return; // no bridging distance across segment boundary
  }

  const meters = haversine(previousAccepted, raw);
  await repository.appendAcceptedEdge(tripId, previousAccepted, raw, meters);
  previousAccepted = raw;
  scheduleUiRefresh();
}
```

Pseudocode chỉ diễn giải logic; cần implement await/queue/transaction đúng để không có race khi callback dồn và không có side-effect không được await.

## 11. Replay fixtures bắt buộc

- STATIONARY: 5 phút đứng yên với GPS jitter, distance gần 0, stopped được xác nhận.
- STRAIGHT: đường thẳng với timestamp ổn định, distance đúng Haversine ± rounding.
- NOISE: đột biến 1km trong 2s → reject outlier.
- GAP: mẫu A rồi 90s sau mẫu B → `unknownMs` tăng, không cộng A→B.
- PAGE_HIDDEN: hidden/visible liên tiếp → hai segment, no bridging.
- PAUSE: pause trong 120s → pausedMs đúng, không cộng distance.
- SPEED_NULL: coords.speed=null → derived speed vẫn tính được.
- CLOCK_ERROR: điểm timestamp đảo ngược hoặc trùng → reject, không crash.
- END_WITHOUT_FIX: kết thúc sau mất GPS → no fabricated endpoint, report incomplete.
- BROWSER_RELOAD: trip live persisted, resume in new segment, not retroactive track.


---


# 06. UX/UI Specification — Mobile-first

## 1. Navigation

Bottom navigation (mobile): **Trang chủ | Lịch sử | So sánh**; trang **Đang đo** ưu tiên toàn màn hình, các nút thao tác rõ. Desktop có sidebar. Không thêm onboarding phức tạp, chỉ hướng dẫn quyền định vị lần đầu.

## 2. Màn hình Home (`/`)

- Header `RouteTrack` + status pill `GPS: Sẵn sàng / Đang xác định / Chưa cấp quyền / Không hỗ trợ`.
- Bản đồ current location + accuracy circle.
- Dropdown phương tiện; tên trip optional (tự sinh `Hành trình • dd/mm/yyyy hh:mm`).
- Nút lớn **Bắt đầu ghi hành trình**; disabled khi chưa có vị trí hợp lệ.
- Summary `Số chuyến`, `Quãng đường GPS đo được`, `Lần gần nhất`.
- Hint: **“Để ghi liên tục, giữ trang này hiển thị. Trình duyệt có thể ngừng GPS khi khóa màn hình.”**

## 3. Màn hình Tracking (`/tracking`)

- 60% viewport: Leaflet map có polyline nhiều segment, icon current location, start marker và accuracy circle (có toggle).
- Sticky metric cards: `Quãng đường GPS đo được`, `Tổng thời gian`, `Tốc độ hiện tại`, `Tốc độ trung bình`.
- Status: `Đang ghi`, `Tạm dừng`, `Thiếu tín hiệu GPS`, `Đang ở chế độ offline`.
- Controls: **Tạm dừng / Tiếp tục / Kết thúc**. Kết thúc yêu cầu confirm khi còn dữ liệu đang xử lý.
- Toggle `Giữ màn hình sáng` (only if supported); hướng dẫn đây không phải chạy nền.
- Không tự zoom theo GPS nếu user đang chủ động pan/zoom; nút `Theo vị trí` để recenter.
- Không có lời nhắc yêu cầu thao tác trong khi lái xe.

## 4. Trip Detail (`/trips/:id`)

- Hero: tên, ngày, mode, quality badge GOOD/FAIR/LOW + coverage %.
- Map multi-segment + dashed/dotted *không nối gap*; marker tại điểm đầu/cuối.
- Stats: `Quãng đường GPS đo được`, `Tổng thời gian`, `Thời gian di chuyển`, `Dừng`, `Không xác định`, `Tạm dừng`, `Tốc độ TB toàn chuyến`, `Tốc độ TB khi chạy`, `Tốc độ cao nhất`, `Tốc độ thấp nhất`.
- Speed line chart, khoảng UNKNOWN được tô bóng; danh sách các event `PAGE_HIDDEN`, `GPS_GAP`, ...
- Actions: đổi tên, chọn route group, gắn route variant, xuất, xóa.
- Cảnh báo khi LOW: **“GPS thiếu dữ liệu trong X phút; quãng đường hiển thị chỉ là phần đã đo được.”**

## 5. History (`/history`)

- Search tên trip; filters mode/date/route/status; list theo mới nhất.
- List row: date/time, mode, duration, distanceMeasured, coverage, quality.
- `Đang đo chưa hoàn thành` luôn hiển thị cảnh báo khôi phục.

## 6. Compare (`/compare`)

- Chọn 2–4 trips; mặc định chỉ cho cùng A→B và mode, cho override kèm warning.
- Overlay polyline mỗi trip màu khác nhau và legend có tên; **segment gap không nối**.
- Table: `Elapsed`, `Distance measured`, `Moving`, `Stopped`, `Unknown`, `Avg speed`, `Max speed`, `Coverage`, `Departure time`.
- Tính chênh lệch `B-A` về thời gian (phút và %) và chiều dài; nếu có LOW quality thì đánh dấu *không đủ cơ sở kết luận quãng đường*.
- Với ≥5 trips/route variant (P1): median và P90 elapsed, phân phối theo giờ/ngày, sample count.

## 7. Empty/Error/Offline UI

| State | Copy tiếng Việt |
|---|---|
| Permission denied | “Trình duyệt chưa được cấp quyền vị trí. Hãy bật quyền cho website trong cài đặt trình duyệt.” |
| GPS unavailable | “Không xác định được vị trí. Vui lòng kiểm tra dịch vụ vị trí trên thiết bị.” |
| Insecure context | “Tính năng GPS yêu cầu website chạy qua HTTPS.” |
| Hidden/suspended | “Đã có khoảng thời gian không được đo. Quãng đường trong khoảng này không được cộng.” |
| Wake Lock failure | “Thiết bị không cho phép giữ màn hình sáng. Bạn có thể giữ trang hiển thị thủ công.” |
| Storage error | “Không thể lưu thêm điểm GPS. Dữ liệu mới có thể bị mất; hãy kiểm tra bộ nhớ và sao lưu.” |
| No trips | “Chưa có hành trình. Bắt đầu chuyến đầu tiên để xem thống kê.” |
| Offline map | “Không tải được nền bản đồ; dữ liệu hành trình đã lưu vẫn có thể xem.” |

## 8. Accessibility/visual constraints

Nút >=44px trên mobile, chữ rõ >=14px; màu không phải kênh truyền tải duy nhất; status/icon/label đi kèm. Tối ưu battery: render polyline theo batch 1–2 giây khi visible, không refresh DOM mỗi GPS callback. Hỗ trợ prefers-reduced-motion. Không đưa hình ảnh/hiệu ứng thay cho dữ liệu GPS thực.


---


# 07. Test Plan, Acceptance Criteria & Traceability

## 1. Test pyramid

1. **Unit (Vitest):** Haversine, segment splitting, duration partition, speed calculation, outlier filter, coverage, grouping, compare guardrails; random/replay fixtures.
2. **Repository (fake-indexeddb):** CRUD, transaction, schema upgrade, restore, cascade delete, duplicate idempotency.
3. **Component (Testing Library):** states loading/denied/offline/unknown, accessible controls.
4. **E2E (Playwright):** mock geolocation, grant/deny, timer mocked, start→pause→resume→end, history, compare, reload, export.
5. **Real-device field tests:** Android Chrome và iOS Safari nếu có thiết bị; GPS ngoài trời, page visible, tab hidden, screen locked, airplane/offline conditions.

## 2. Unit test cases bắt buộc

| ID | Tình huống | Expected |
|---|---|---|
| GPS-001 | Hai tọa độ biết trước, dt chuẩn | Haversine đúng theo tolerance xác định |
| GPS-002 | Trùng tọa độ + GPS jitter | Quãng đường gần 0; không cộng drift vô lý |
| GPS-003 | 2 điểm cách nhau 90s (maxGap 20s) | Không tính distance nối, cộng UNKNOWN |
| GPS-004 | PAUSE 120s | `pausedMs=120000` và distance trong pause=0 |
| GPS-005 | Visibility hidden/visible | Segment mới, không bridge |
| GPS-006 | Tốc độ đột biến | Reject OUTLIER sau xét accuracy/time |
| GPS-007 | speed null | Derived speed có thể tính khi đủ sample |
| GPS-008 | Timestamps trùng/đảo | Reject/flag, không negative duration |
| GPS-009 | 0 confirmed stop | Min speed không gán 0 nếu không chứng cứ |
| GPS-010 | Tổng thời gian | elapsed = moving+stopped+paused+unknown ±1ms |
| GPS-011 | Dữ liệu thiếu 40% active time | coverage ~60%, LOW |
| GPS-012 | Reverse origin/destination | Không tự gộp A→B và B→A |

## 3. E2E acceptance matrix

| AC | Trace | Test |
|---|---|---|
| AC-01 | FR-01,02 | Được GPS → Start; denied → hướng dẫn cấp quyền |
| AC-02 | FR-03,06 | Nhận vị trí → IndexedDB có raw point sau callback |
| AC-03 | FR-05 | Pause/Resume/End và summary đúng |
| AC-04 | FR-04,07,08 | Hidden/resume → 2 đoạn, không nối trực tiếp |
| AC-05 | FR-09,10 | Refresh/trip detail/history vẫn còn dữ liệu |
| AC-06 | FR-11 | So sánh 2 chuyến, overlay đúng, có warning condition mismatch |
| AC-07 | FR-13 | Hai tab không tạo hai recorder trên cùng thiết bị |
| AC-08 | FR-14 | Xóa cascade và confirm hoạt động |
| AC-09 | FR-15 | Offline, denied, storage error không crash |
| AC-10 | FR-16 | Wake Lock graceful degradation khi thiếu API |
| AC-11 | FR-21 | Export GPX tách segment, CSV/JSON đúng schema |

## 4. Thử nghiệm thực địa

**Quy tắc an toàn:** chỉ thao tác khi đã dừng an toàn; không nhìn/bấm điện thoại khi điều khiển phương tiện. Người kiểm thử có thể dùng hành trình đi bộ để kiểm tra GPS cơ bản.

- Device A: Chrome Android, PWA installed/uninstalled; Device B: Safari iOS khi có.
- Test T1: 15–30 phút ngoài trời, màn hình mở, thu baseline GPS.
- Test T2: bật/tắt Wake Lock theo khả năng thiết bị.
- Test T3: chuyển tab, khóa màn hình rồi trở lại; kiểm tra cờ UNKNOWN (không yêu cầu browser ghi nền).
- Test T4: mất Internet nhưng vẫn cấp GPS; dữ liệu lưu local, tiles có thể biến mất.
- Test T5: chuyển từ Wi-Fi sang mạng di động, refresh và resume; không giả định có điểm trong lúc đóng.
- Test T6: so sánh hành trình trên 2 tuyến và đối chiếu thực tế bằng nguồn tham chiếu độc lập, ghi sai số như **kết quả quan sát**, không coi là SLA.
- Test T7: xử lý dung lượng đầy/quyền GPS bị thu hồi.

## 5. Ngưỡng nghiệm thu kỹ thuật nội bộ

- Không có lỗi type/lint/unit/build trong CI.
- Dữ liệu sau mỗi sample đã commit phải còn sau refresh.
- Gap >20s hoặc page hidden được thể hiện, không cộng đường nối.
- Nếu có 10k GPS points trong history, không freeze UI quá mức trên thiết bị thử nghiệm; ghi lại đo lường fps/time và tối ưu.
- Khi quality LOW, Compare UI phải hiển thị warning trước kết luận.
- Không có request upload tọa độ lên domain ứng dụng hoặc third-party analytics trong MVP; tile requests ra map provider được giải thích.

## 6. Definition of Done theo mỗi task

- Có PR/commit gắn requirement ID.
- Có test theo mức phù hợp và tài liệu thay đổi.
- Không tạo dependency ngoài stack chốt nếu không có giải thích tradeoff.
- Tài liệu README, AGENTS và SRS cập nhật khi business rule đổi.
- Có demo/mock sensor dễ tái hiện khi chưa có thiết bị GPS trong môi trường lập trình.


---


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


---


# 09. Scaling, API giao thông và lộ trình dữ liệu cloud

## 1. Triển khai MVP gọn nhẹ

- Hosting tĩnh Cloudflare Pages, build `npm run build`, output `dist`, HTTPS và CDN.
- Không có backend: ghi GPS vào IndexedDB cục bộ, tính toán trên thiết bị, cache PWA app shell.
- Scale đọc web app chủ yếu do CDN, không cần trả phí database cho người dùng đơn lẻ.
- Tính ổn định phụ thuộc browser/thiết bị, không tăng bằng cách bổ sung server khi trang không nhận GPS.

## 2. Những ngưỡng khiến cần backend

| Trigger | Hướng nâng cấp |
|---|---|
| Đồng bộ đa thiết bị | Supabase Auth + Postgres/PostGIS + background sync when app is active |
| Nhiều người dùng | Row Level Security, tenant/user ID, retention & export policies |
| Traffic API có khóa bí mật | Serverless API proxy (Cloudflare Pages Functions/Workers) |
| Báo cáo thống kê đa người dùng | PostgreSQL analytics, materialized views theo kỳ |
| Khối lượng point lớn | Batch uploads, partition theo tháng/trip, retention, indexes |
| So sánh lộ trình chính xác | PostGIS geospatial + Map Matching qua provider phù hợp |

## 3. Thiết kế sync nếu mở rộng

Thiết kế `SyncPort` độc lập sau M5:

- Local-first: app ghi IndexedDB trước, đánh dấu unsynced, upload theo batch khi online/trang còn hoạt động.
- Event ID/point ID toàn cục (UUID) để idempotent upsert.
- Không đồng bộ dữ liệu vị trí cho đến khi user bật tính năng và đồng ý với privacy policy.
- `user_id`, `tenant_id`, `schema_version`, `device_id` và conflict strategy; không tạo sẵn các bảng này trong MVP.
- PostGIS: `geography(Point, 4326)` cho origin/dest, `ST_DWithin` lọc điểm theo bán kính mét; geometry/linestring cho route segments nếu có truy vấn không gian.

## 4. Giao thông từ GPS và từ nhà cung cấp

**MVP: chỉ quan sát chuyển động của người dùng.** Đo tốc độ dưới ngưỡng, thời gian dừng, biến động, không xác nhận là ùn tắc hay tai nạn.

**P2: TrafficProvider** được tích hợp bằng API proxy với rate limiting, cache đúng chính sách, thông tin xuất xứ/mốc thời gian, không hardcode API key trong frontend. Kiến trúc:

```
React -> `/api/traffic/flow?lat=...&lng=...` (Cloudflare Worker)
          -> Provider SDK / REST API
          -> normalize {time, provider, roadSegmentRef, currentSpeed, freeFlowSpeed, confidence}
          -> return to client and record if permitted by license
```

Khảo sát:

- **TomTom Traffic Flow**: dữ liệu current/free-flow speed và confidence trong tài liệu legacy. TomTom khuyến nghị Orbis APIs cho tích hợp mới, nên xem khả năng cụ thể trước khi chọn.
- **Google Routes API traffic-on-polylines**: thông tin `NORMAL/SLOW/TRAFFIC_JAM` trên tuyến **do Google tính**, không mặc định trùng GPS track đã ghi. Việc hiển thị, cache và lưu dữ liệu phải theo terms Google; không mặc định overlay cùng Leaflet/OSM.
- **Map Matching** (P2): nếu muốn gán giao thông theo đoạn đường đã đi, cần ánh xạ GPS track sang road graph có tính đến hướng và mức tin cậy.

**Không được** lấy tình trạng giao thông hôm nay để diễn giải một chuyến diễn ra hôm qua. Muốn xem lịch sử, phải có snapshot tại thời điểm di chuyển và quyền lưu trữ hợp lệ.

## 5. Ứng dụng để so sánh tuyến đường khác nhau

- `RouteGroup` phân loại cùng A→B, direction, mode. `RouteVariant` do người dùng đặt tên ở MVP.
- P1: tính median, P90 thời gian cho từng variant và khung giờ, kèm n và tỷ lệ chuyến chất lượng GOOD/FAIR.
- Không tự đưa ra kết luận causal ‘do tắc đường’ hoặc ‘đường B luôn nhanh hơn’ khi số mẫu ít và điều kiện khác nhau.
- P2: route overlap / Frechet similarity sau map matching, provider distance, traffic observed, bảng phân tích thay đổi theo thời điểm.

## 6. Chi phí và rủi ro

- Phí MVP: hosting static và map tile theo chính sách nhà cung cấp (mức miễn phí/quota cần xem tại thời điểm deploy).
- Traffic API: tính phí theo request và tier; lên bảng rate limit, cache, retention, khóa bí mật, user consent, bản đồ hiển thị tương thích nhà cung cấp.
- IndexedDB: có thể mất khi user xóa website data, private mode hoặc pressure; backup JSON là bắt buộc.
- GPS: phụ thuộc quyền/trang visible; người dùng muốn khóa màn hình và vẫn ghi liên tục thì web-only không đáp ứng yêu cầu bảo đảm.

## 7. Quy tắc thay đổi kiến trúc

Không thêm backend chỉ vì có nhiều chuyến trên một điện thoại. Chỉ thêm khi có use case cụ thể, test load và thiết kế privacy. Bất kỳ thay đổi nào có chi phí API, dữ liệu định vị lên cloud, phụ thuộc provider mới hoặc quyền truy cập mới đều cần chốt business requirement trước khi code.


---


# 10. Nguồn kỹ thuật chính thức (đối chiếu 05/11/2026)

Những nguồn dưới đây dùng để xác nhận **khả năng thực tế và giới hạn** của trình duyệt, thư viện và nhà cung cấp. AI coding agent phải kiểm tra tài liệu mới nhất và độ tương thích phiên bản khi tiến hành code.

1. **W3C Geolocation — 2026 Candidate Recommendation Draft:** cập nhật vị trí cho tài liệu fully-active visible, hidden updates có thể bị bỏ. https://www.w3.org/TR/2026/CRD-geolocation-20261030/
2. **MDN `watchPosition()`:** HTTPS, quyền vị trí, cách đăng ký theo dõi. https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition
3. **MDN Screen Wake Lock:** chỉ giữ màn hình sáng cho trang active, tự release khi hidden. https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
4. **MDN visibilitychange:** life cycle và tab/app hidden. https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
5. **MDN Service Worker:** cache/offline/background sync, không biến thành GPS native. https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
6. **MDN StorageManager.persist:** persistent storage là yêu cầu browser có thể từ chối. https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
7. **Dexie docs:** wrapper IndexedDB, query/migration/transaction. https://dexie.org/docs
8. **React Leaflet Polyline:** vẽ các đoạn tuyến. https://react-leaflet.js.org/docs/api-components/
9. **Leaflet reference:** Polyline, bounds, markers. https://leafletjs.com/reference
10. **vite-plugin-pwa:** manifest/app-shell/service worker. https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/guide/index.md
11. **OSM Tile Usage Policy:** attribution, cache theo headers, không bulk download / prefetch offline, không có SLA. https://operations.osmfoundation.org/policies/tiles/
12. **Cloudflare Pages React:** Vite build/dist, deploy HTTPS. https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
13. **PostGIS ST_DWithin:** filtering geography bằng mét cho geospatial khi mở rộng. https://postgis.net/docs/ST_DWithin.html
14. **TomTom Traffic API:** legacy Flow API có current/free-flow speed/confidence; nhà cung cấp đề xuất Orbis cho tích hợp mới. https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/traffic-flow-service
15. **TomTom Orbis Traffic API:** xem sản phẩm/gói API mới. https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-flow/traffic-flow-service
16. **Google Routes API traffic-on-polylines:** phân loại NORMAL/SLOW/TRAFFIC_JAM và chính sách tính phí bổ sung. https://developers.google.com/maps/documentation/routes/traffic_on_polylines

**Không tái sử dụng nguyên văn dài nội dung tài liệu của bên thứ ba.** Bộ spec diễn giải quy tắc thiết kế và dẫn link để kiểm tra khi triển khai.


---
