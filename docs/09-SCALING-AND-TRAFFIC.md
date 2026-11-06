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
