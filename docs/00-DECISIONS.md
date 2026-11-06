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

**Đối chiếu ADR-11 (06/11/2026):** giữ Cloudflare Pages — gói Free không giới hạn băng thông tĩnh, cho phép dùng thương mại, preview theo nhánh, `_headers`. Cloudflare khuyến nghị *Workers Static Assets* cho dự án mới nhưng Pages vẫn được hỗ trợ đầy đủ; chỉ chuyển khi có lý do cụ thể (app thuần tĩnh, không dùng tính năng riêng của Workers). Vercel Hobby cấm dùng thương mại; Netlify Free tính theo credit. Header bảo mật/CSP sinh lúc build từ `deploy/securityHeaders.ts`.

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
