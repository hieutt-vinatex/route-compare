# Prompt khởi động cho Claude Code

Đặt `CLAUDE.md` và `AGENTS.md` tại repository root; `CLAUDE.md` có dòng `@AGENTS.md` để import quy tắc chung.

---

Hãy đóng vai senior full-stack engineer (nhưng phạm vi sản phẩm này là **frontend PWA web-only**) và xây dựng RouteTrack Web theo tài liệu sẵn có trong repo.

Đọc `CLAUDE.md`, `AGENTS.md` và tất cả tài liệu `docs/00...10`. Không bỏ qua `docs/05-GPS-ALGORITHMS.md` hoặc thay đổi các quyết định tại `docs/00-DECISIONS.md`.

### Trước khi chỉnh code

- Kiểm tra source có sẵn; trình bày một implementation plan gồm milestones, phạm vi file, dependency list, risks và test acceptance.
- Chốt React + TypeScript + Vite + Tailwind + Leaflet + Dexie + Chart.js + vite-plugin-pwa. Không thêm native bridge, backend hay yêu cầu đăng nhập.
- Nhắc rõ trong README và UI: browser không bảo đảm callback GPS khi khóa màn hình/chuyển app; Screen Wake Lock chỉ giữ màn hình sáng khi active.

### Bắt đầu triển khai

Hoàn thành M0 và M1 theo `docs/08-ROADMAP.md`:
1. Scaffold app, routing, UI mobile-first tiếng Việt.
2. Viết browser Geolocation Adapter có mock cho tests và lifecycle idempotent.
3. Tạo tracking view có Start/End, Leaflet map, status, permission UX.
4. Tạo visibility handling và optional Wake Lock; hidden/resume đánh dấu gap, không nối quãng đường qua gap.
5. Đưa kiểm thử vào CI, chạy typecheck/lint/test/build.

Sau khi M0/M1 xong, báo cáo pass/fail từng test, file đã sửa, điều chưa kiểm chứng thực địa. Tiếp tục triển khai M2–M5 theo từng mốc nhỏ trên yêu cầu của tôi hoặc sau khi đã xác nhận các gate của mốc trước.

### Không được làm

- Không khẳng định đo GPS khi màn hình khóa.
- Không đưa GPS logic vào UI component, không dùng Zustand làm DB.
- Không xóa/ghi đè dữ liệu người dùng đang tồn tại khi thử migrations.
- Không dùng third-party analytics hoặc gửi raw GPS lên cloud.
- Không tạo database server, API proxy, bản đồ offline bằng bulk prefetch.
- Không tự thêm tính năng theo dõi người khác hay background location.

---

## Prompt review sau mỗi milestone

Hãy code review toàn bộ thay đổi của milestone vừa làm theo `AGENTS.md` và `docs/07-TEST-PLAN.md`, kiểm tra đặc biệt GPS gap, timestamp, pause, quãng đường đo được, chất lượng dữ liệu, multi-tab, IndexedDB transactions và quyền riêng tư. Liệt kê lỗi theo severity, sửa lỗi có thể sửa an toàn, chạy lại tests, ghi lại những hạng mục cần kiểm thử trên điện thoại thật.
