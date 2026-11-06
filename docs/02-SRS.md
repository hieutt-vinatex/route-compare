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
