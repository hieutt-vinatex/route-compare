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
