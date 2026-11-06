# Prompt khởi động cho OpenAI Codex

Dán prompt này tại repository root chứa `AGENTS.md` và thư mục `docs/`.

---

Bạn là lead engineer phụ trách triển khai **RouteTrack Web**, một web application/PWA dùng GPS browser để đo và so sánh hành trình thực tế.

**Đầu tiên hãy đọc** `AGENTS.md` cùng `docs/00-DECISIONS.md`, `docs/01-BRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/04-DATA-MODEL.md`, `docs/05-GPS-ALGORITHMS.md`, `docs/06-UI-UX.md`, `docs/07-TEST-PLAN.md` và `docs/08-ROADMAP.md`.

### Quy tắc không được vi phạm

- Bắt buộc **web-only**: React + TypeScript + Vite + PWA; **không** Capacitor, không mobile APK, không backend/cloud trong MVP.
- GPS dùng Web Geolocation `watchPosition()`. **Không hứa GPS chạy khi khóa màn hình**, không dùng Service Worker để lấy GPS, không giả lập background tracking.
- Track có thể gồm nhiều segment. Khi mất GPS hoặc tab bị hidden, đánh dấu UNKNOWN, không cộng đoạn thẳng nối các tọa độ qua gap.
- IndexedDB + Dexie là nguồn sự thật; location points phải được persist trước khi kết luận số liệu đã an toàn.
- Phân tách `src/domain`, `src/adapters`, `src/data`, `src/pages`, có typed interfaces và unit tests.
- Không tự động thêm dependencies/API bên ngoài stack đã chốt; không lưu khóa bí mật trong frontend.

### Phương pháp triển khai

1. Kiểm tra repository hiện tại, **không ghi đè công việc có sẵn**.
2. Lập kế hoạch thực hiện M0 rồi M1, chỉ rõ file sẽ tạo và test acceptance.
3. Thực hiện M0 (scaffold, lint, typecheck, test, build, routes). Không hỏi tôi lại những điều đã được chốt trong docs.
4. Thực hiện M1 (GPS browser adapter, Geolocation mocks, permission state, live tracking map, Start/End, visibility & Wake Lock graceful fallback) sau khi M0 test pass.
5. Tạo `demo/mock GPS replay` để UI test được ngay cả khi máy lập trình không có GPS.
6. Chạy `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`; nếu lệnh không thể chạy, chỉ ra lý do chính xác.
7. Báo cáo file thay đổi, requirement IDs đã xong, kiểm thử, giới hạn GPS, backlog M2–M5.

**Tiêu chí sản phẩm đầu tiên:** có giao diện responsive tiếng Việt, hiển thị được vị trí khi cấp quyền, bắt đầu/kết thúc được chuyến, vẽ đường GPS mock và hiển thị cảnh báo đúng khi trang hidden. Không được dùng dữ liệu mock để tuyên bố GPS ngoài đời đã kiểm thử.

---

## Prompt tiếp tục sau M1

Đọc trạng thái repo/README và `docs/08-ROADMAP.md`, triển khai **M2 – GPS reliability & IndexedDB**. Viết unit tests GPS-001 đến GPS-010 trước. Thiết lập schema Dexie, raw data, segments/gaps, pause/resume/recovery và summary. Không triển khai M3–M5 nếu M2 chưa qua gates. Gửi báo cáo thay đổi và các limitation chưa kiểm thử thiết bị thật.

## Prompt tiếp tục sau M2

Triển khai **M3/M4** theo docs: history, trip detail, speed/quality charts, compare 2–4 trips, warnings condition mismatch, manual route variant, export GPX/CSV/JSON. Duy trì typed repositories và tests, không thêm backend. Mỗi milestone phải có build/test passing.

## Prompt chốt phát hành

Thực hiện **M5**: PWA app-shell cache, tránh prefetch OSM tiles, triển khai Cloudflare Pages HTTPS, Playwright responsive/permission/offline tests, QA báo cáo GPS trên thiết bị thật nếu thiết bị được cung cấp. Nếu không có thiết bị, ghi rõ giới hạn nghiệm thu và hướng dẫn người dùng chạy field test; không tự bịa kết quả đo.
