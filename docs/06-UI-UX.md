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
- Cảnh báo khi LOW: **“Có X phút không xác định được đang đi hay dừng (mất GPS hoặc GPS chưa đủ chính xác); quãng đường hiển thị chỉ là phần đã đo được.”** X = toàn bộ thời gian *Không xác định* (mất GPS + GPS chưa đủ bằng chứng) — chính phần làm giảm độ phủ và nhãn chất lượng; dưới 1 phút ghi “dưới 1 phút”.

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
