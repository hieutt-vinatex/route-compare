# CLAUDE.md — RouteTrack Web

@AGENTS.md

## Hướng dẫn riêng cho Claude Code

- Khởi động bằng cách đọc `docs/00-DECISIONS.md`, `docs/01-BRD.md`, `docs/02-SRS.md`, `docs/03-ARCHITECTURE.md`, `docs/05-GPS-ALGORITHMS.md`, `docs/07-TEST-PLAN.md` và `docs/08-ROADMAP.md`.
- Làm tuần tự M0 → M5 theo `docs/08-ROADMAP.md`, mỗi lần một scope rõ. Trước sửa nhiều file, đề xuất plan với acceptance test.
- Không mở rộng stack, không triển khai Capacitor/native hoặc background GPS giả.
- Tích hợp Browser API sau khi đã có test mocks; dùng fixture GPS replay để test algorithm.
- Khi nghiệm thu GPS, phân biệt kết quả mô phỏng (Playwright) với kiểm thử trên thiết bị thật.
- Sau mỗi milestone: tóm tắt thay đổi, tests chạy, khiếm khuyết, bước tiếp theo, cập nhật README.
