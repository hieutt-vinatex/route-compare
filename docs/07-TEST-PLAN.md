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

## 7. Trạng thái truy vết (cập nhật sau M2, 06/11/2026)

Kiểm thử **mô phỏng** (Vitest + Playwright với GPS giả lập). Chưa có kết quả thiết bị thật.

| ID | Trạng thái | Test |
|---|---|---|
| GPS-001 | ✅ | `src/domain/geo/haversine.test.ts`, STRAIGHT trong `trackProcessor*.test.ts` |
| GPS-002 | ✅ | `trackProcessor.filters.test.ts` (5 phút đứng yên < 5 m) |
| GPS-003 | ✅ | `trackProcessor.test.ts` (không nối), `analyzeTrip.test.ts` (~90 s UNKNOWN) |
| GPS-004 | ✅ | `trackProcessor.filters.test.ts`, `TrackingController.test.ts`, E2E AC-03 |
| GPS-005 | ✅ | `trackProcessor.test.ts`, `TrackingController.test.ts`, E2E tracking |
| GPS-006 | ✅ | `trackProcessor.filters.test.ts` |
| GPS-007 | ✅ | `trackProcessor.test.ts` (live), `trackProcessor.filters.test.ts` “live speed” (BR-07: đi chậm trong sai số → `—`, 0 chỉ khi dừng ≥ 15 s), `analyzeTrip.test.ts` “SPEED_NULL classification” (đi bộ/xe đạp/ô tô, accuracy 5–15 m, điểm thưa 8 s) |
| GPS-008 | ✅ | `trackProcessor.test.ts`, `trackProcessor.clock.test.ts` (CLOCK_ERROR) |
| GPS-009 | ✅ | `analyzeTrip.test.ts` |
| GPS-010 | ✅ | `analyzeTrip.test.ts` (± 1 ms) |
| GPS-011 | ✅ | `analyzeTrip.test.ts` (~60 %, LOW) |
| GPS-012 | ⏳ M4 | nhóm A→B |
| AC-01, AC-02, AC-04, AC-10 | ✅ | `e2e/tracking.spec.ts` |
| AC-03, AC-05, AC-07, AC-09 | ✅ | `e2e/persistence.spec.ts` |
| NFR-02, NFR-06 (header/CSP, không gửi dữ liệu ra ngoài) | ✅ | `deploy/securityHeaders.test.ts`, `e2e/security.spec.ts`, kiểm tra vi phạm CSP cuối `e2e/tracking.spec.ts` |
| AC-06, AC-08, AC-11 | ⏳ M3/M4 | |

Hiệu năng (§5): `analyzeTrip` trên 10 000 điểm đo được ~100 ms (lần đầu) / ~40 ms (đã warm) trên máy phát triển; trên điện thoại thật cần đo lại.
