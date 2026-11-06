# AGENTS.md — RouteTrack Web (Codex / Claude Code / AI coding agents)

## Mục đích và nguồn sự thật

Repository này chứa RouteTrack Web — **PWA web-only, mobile-first, local-first** để ghi và so sánh hành trình GPS thực tế. Trước khi code phải đọc:

1. `docs/00-DECISIONS.md` — các quyết định được chốt, không tự đổi stack.
2. `docs/01-BRD.md` — quy tắc nghiệp vụ.
3. `docs/02-SRS.md` — FR/NFR, lỗi và nghiệm thu.
4. `docs/05-GPS-ALGORITHMS.md` — tiêu chuẩn kỹ thuật tính toán bắt buộc.
5. `docs/07-TEST-PLAN.md` và `docs/08-ROADMAP.md` — kiểm thử/triển khai theo mốc.

**Business rule > UI demo.** Khi xung đột giữa docs, báo rõ cho maintainer, ưu tiên `00-DECISIONS` về phạm vi và `05-GPS-ALGORITHMS` về phép tính, không tự âm thầm sáng tác lại.

## Tech stack không tự ý thay

React + TypeScript + Vite + Tailwind CSS + React Router + Zustand + Leaflet/React Leaflet + Dexie/IndexedDB + Chart.js/react-chartjs-2 + vite-plugin-pwa + Vitest + Testing Library + Playwright. Static deployment Cloudflare Pages. `npm` + lockfile. Không dùng Next.js, Firebase, backend, database cloud, native/Capacitor trong MVP.

## GPS truthfulness — MUST

- Browser Geolocation **không** cung cấp background GPS bảo đảm khi khóa màn hình/trang hidden; không viết code mô phỏng/tuyên bố ‘khóa màn hình vẫn ghi liên tục’.
- Service Worker **không được gọi** `navigator.geolocation`; SW chỉ cache app shell.
- Screen Wake Lock **chỉ** giúp giữ trang hiển thị khi hệ thống cho phép.
- Lưu RAW GPS sample với accuracy/time rồi mới phân tích. Không bỏ qua data-quality error.
- **Không nối hai sample qua gap, pause, hidden window thành quãng đường đã đi.** Dùng segment ID riêng, `unknownMs` riêng.
- Phân biệt `distanceMeasuredM` với quãng đường thực chưa thể xác nhận; thiếu GPS = UNKNOWN, không phải STOPPED.
- Các speed phải có unit rõ, lọc nhiễu và test; không hiển thị 0 khi dữ liệu không có.
- Tuyệt đối không dùng heuristic tắc đường như xác nhận traffic provider.

## Coding practices

1. Trước task lớn: Plan → liệt kê files và test cần thay đổi → mới implement. Tránh sửa không liên quan.
2. `src/domain` chứa pure logic, không phụ thuộc React/DOM/IndexedDB; dùng dependency injection cho Clock/Geolocation.
3. `src/data/repositories` là lối duy nhất đọc/ghi IndexedDB; React components không gọi thẳng DB.
4. `src/adapters` đóng gói browser API, mock test. Không lưu track points trong Zustand như nguồn sự thật.
5. Đặt type chặt (strict); không `any` nếu có thể định nghĩa.
6. Viết replay fixtures/test trước khi sửa công thức GPS; thông số heuristic configurable.
7. Không nâng major dependencies, thêm API phí, đổi schema phá dữ liệu, hoặc bổ sung tracking/cloud mà không làm rõ tác động.
8. Dữ liệu GPS nhạy cảm: không gửi lên server, không logger tọa độ thật, không hardcode API key vào frontend.
9. Không thêm yêu cầu tương tác khi user đang điều khiển xe; các nút chính chỉ dùng khi đã dừng an toàn.
10. Update docs và acceptance matrix khi đổi nghiệp vụ.

## Gates trước khi báo hoàn thành

Chạy (hoặc nếu môi trường thiếu dependency, báo rõ không chạy được):

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Với thay đổi UI lớn, chạy Playwright và kiểm tra mobile width 360/390px. Với data model, chạy migrations/recovery tests. Với GPS, chạy `GPS-001 ... GPS-012` theo test plan.

## Cách báo kết quả mỗi milestone

- Mục tiêu và những requirement IDs hoàn thành.
- File chính đã tạo/sửa, kiến trúc vẫn giữ nguyên.
- Các lệnh test, kết quả pass/fail, limitations.
- Dữ liệu nào là mock, điều gì chưa thể kiểm tra trên thiết bị thật.
- Risk/follow-up có thứ tự ưu tiên.

## Quy trình phê duyệt

Nếu phát sinh nhu cầu GPS chạy nền thật sự, native app, thu thập dữ liệu trên cloud, Traffic API, thanh toán hoặc quyền truy cập mới: không tự triển khai; báo rõ đây là ngoài phạm vi web-only MVP.
