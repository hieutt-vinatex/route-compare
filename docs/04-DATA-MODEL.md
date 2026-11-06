# 04. Data model, IndexedDB và hợp đồng dữ liệu

## 1. Quy ước chung

- UUID v4 cho Trip, Point, Event, RouteGroup; `sourceSeq` tăng đơn điệu trong mỗi trip.
- Timestamps là **milliseconds since Unix epoch UTC**, hiển thị múi giờ thiết bị (`Asia/Bangkok` ở Việt Nam thường +07 nhưng không hardcode timezone vào dữ liệu).
- Khoảng cách dùng **m**, thời gian dùng **ms**, speed dùng **m/s** trong domain; UI chuyển sang km/h và km.
- Lat/lng là WGS84 decimal degrees. Không chuyển GPX `lat/lon` thành pixel map.
- Không dùng số 0 thay `null` khi speed thiếu.

## 2. Bảng/collection `trips`

| Trường | Type | Notes |
|---|---|---|
| id | string UUID | PK |
| name | string | Người dùng có thể đổi tên |
| transportMode | WALK/BICYCLE/MOTORBIKE/CAR | Required |
| routeGroupId | string/null | Index |
| routeVariantLabel | string/null | Tên tuyến do user gắn |
| status | IDLE/STARTING/RECORDING/PAUSED/FINALIZING/COMPLETED/INTERRUPTED | Active states do not include IDLE persisted |
| startedAt | number | UTC ms |
| endedAt | number/null | UTC ms |
| startLat/startLng | number/null | Tọa độ hợp lệ đầu |
| endLat/endLng | number/null | Tọa độ hợp lệ cuối |
| distanceMeasuredM | number | Tổng các đoạn GPS đã đo được |
| elapsedMs | number | Start→End |
| pausedMs | number | User pause |
| movingMs | number/null | Classified moving (null = chưa tính, chuyến chưa kết thúc) |
| stoppedMs | number/null | Classified stopped (null = chưa tính) |
| unknownMs | number/null | Không có đủ GPS (null = chưa tính) |
| avgElapsedKmh | number/null | Chỉ số door-to-door, distanceMeasured / elapsed |
| avgMovingKmh | number/null | Distance / moving time |
| maxSpeedKmh/minSpeedKmh | number/null | Sau filter/smoothing |
| coveragePct | number/null | % thời gian có dữ liệu hợp lệ; null khi elapsed − paused ≤ 0 |
| qualityLabel | GOOD/FAIR/LOW/null | Heuristic có version; null khi chưa tính |
| isIncomplete | boolean | Có gap/thiếu mẫu lớn hoặc kết thúc bất thường |
| metricsVersion | number | Bật tính lại khi nâng thuật toán |
| createdAt/updatedAt | number | UTC ms |

## 3. Bảng `gpsPoints`

| Trường | Type | Notes |
|---|---|---|
| id | UUID | PK |
| tripId | UUID | Index |
| sourceSeq | number | Unique compound `[tripId+sourceSeq]` |
| sourceTimestamp | number | GeolocationPosition.timestamp |
| recordedAt | number | Khi callback đã nhận |
| latitude/longitude | number | Geographic point |
| accuracyM | number/null | Provider horizontal accuracy |
| speedMps | number/null | Provider speed |
| headingDeg | number/null | Provider heading |
| segmentId | number/null | Null nếu reject |
| accepted | boolean | Raw sample retained |
| rejectCode | enum/null | RANGE, TIMESTAMP, DUPLICATE, STALE, ACCURACY, OUTLIER, UNTRUSTED |
| derivedSpeedMps | number/null | Computed between consecutive accepted samples |

## 4. Bảng `tripEvents`

`id, tripId, seq, timestamp, type, metadata` (object JSON-serializable; `seq` xem §10), type: `START, PAUSE, RESUME, END, GPS_GAP_BEGIN, GPS_GAP_END, GPS_ERROR, PAGE_HIDDEN, PAGE_VISIBLE, WAKELOCK_ACQUIRED, WAKELOCK_RELEASED, STORAGE_ERROR, RECOVERY`.

## 5. Bảng `routeGroups`

`id, name, originLat, originLng, destinationLat, destinationLng, radiusM(default 150), createdAt, updatedAt`. Chỉ nhóm cùng hướng A→B. Đường cụ thể phân biệt qua `routeVariantLabel` và overlay, không tự kết luận cùng variant.

## 6. Chỉ mục Dexie đề xuất

```ts
// Reference schema, adjust TS types in implementation.
db.version(1).stores({
  trips: 'id, startedAt, status, transportMode, routeGroupId, updatedAt',
  gpsPoints: 'id, tripId, [tripId+sourceSeq], [tripId+sourceTimestamp]',
  tripEvents: 'id, tripId, [tripId+timestamp], type',
  routeGroups: 'id, name'
});
```

Migrations thông qua `db.version(n).stores(...).upgrade(...)`. Unit test bằng fake-indexeddb hoặc IndexedDB test environment. Không thay schema phá dữ liệu người dùng khi nâng cấp.

## 7. Transaction và tính nhất quán

- Điểm thô được `add/put` theo giao dịch; cập nhật `sourceSeq` và trip progress idempotent.
- `deleteTripCascade` xóa Trip + all gpsPoints + all tripEvents trong một transaction.
- Không ghi 100% polyline JSON vào `trips` sau mỗi sample; dữ liệu chi tiết nằm ở `gpsPoints`.
- Summary có thể tái dựng bằng raw points + events, tính bằng `metricsVersion`.
- Trên kết thúc, freeze final stats sau khi xử lý hết async writes; tuyệt đối không xóa track khi failed finalize.

## 8. Import/Export

- JSON backup: `{ schemaVersion, exportedAt, appVersion, trips, gpsPoints, tripEvents, routeGroups }`; kiểm tra bằng Zod, không nhập file quá lớn không giới hạn mà không hỏi.
- CSV: một hàng mỗi point với `trip_id, timestamp_iso, lat, lng, accuracy_m, speed_mps, segment_id, accepted, reject_code`.
- GPX: `<trkseg>` riêng cho mỗi segment, không nối qua gap; thời điểm ISO8601 UTC; thuộc tính speed mở rộng nếu cần.
- P1 export bảo vệ riêng tư: chọn ẩn điểm trong bán kính X ở đầu/cuối hoặc chỉ xuất các đoạn ở giữa; thông báo dữ liệu đã được cắt bớt.
- Import phải chịu được version cũ, trùng UUID, sai định dạng; báo lỗi rõ và tránh ghi nửa chừng.

## 9. Dung lượng và retention

MVP không tự xóa chuyến. Hiển thị tổng số chuyến + dung lượng ước lượng; yêu cầu persistent storage khi được hỗ trợ (`navigator.storage.persist()`) nhưng không coi là bảo đảm. Người dùng có thể xóa site data; luôn có chức năng backup.

## 10. Ghi chú triển khai M2 (maintainer duyệt 06/11/2026)

Các quyết định dưới đây giải quyết chỗ chưa nhất quán giữa §3/§6 và docs/03; chúng **bổ sung** (additive) cho schema v1, không phá dữ liệu.

| Mã | Quyết định | Lý do |
|---|---|---|
| D1 | `gpsPoints` có index **unique** `&[tripId+sourceSeq]` | §3 ghi “Unique compound”; ngăn ghi trùng một mẫu khi retry |
| D2 | `tripEvents.seq`: cùng **một bộ đếm theo chuyến** với `gpsPoints.sourceSeq`; boundary (ẩn/hiện trang, tạm dừng/tiếp tục, khởi động lại watcher) lấy số khi **đến**. `timestamp` của event là đồng hồ app (cùng đồng hồ với `recordedAt`); thời gian GPS (nếu cần) nằm trong `metadata` | Replay điểm + sự kiện theo `seq` tái tạo chính xác thứ tự đã xử lý live (ADR-16), kể cả khi trùng timestamp |
| D3 | Chuyến chưa từng có điểm GPS hợp lệ không thể “Kết thúc”, chỉ có thể Hủy (giữ SRS §6) | Không tạo COMPLETED khi không có điểm bắt đầu |
| D4 | Các trường analytics (`movingMs`, `stoppedMs`, `unknownMs`, các tốc độ, `coveragePct`, `qualityLabel`) là `number \| null`; `null` = không tính được / chuyến chưa kết thúc, UI hiển thị “—” | AGENTS.md: không dùng 0 thay cho dữ liệu thiếu |
| R1 | Kết thúc chuyến dang dở sau khi tải lại trang: `endedAt` = hoạt động cuối đã lưu (max của checkpoint `trips.updatedAt`, `gpsPoints.recordedAt`, `tripEvents.timestamp`), không phải lúc mở lại app; `isIncomplete = true` | Không thổi phồng `elapsedMs` bằng thời gian app bị đóng |

`metricsVersion`: `0` = tiến độ tạm khi đang ghi (checkpoint mỗi 15 s và khi trang bị ẩn); `1` = analytics docs/05 tính từ dữ liệu thô đã lưu khi Kết thúc.

Schema v1 thực tế (`src/data/db.ts`):

```ts
db.version(1).stores({
  trips: 'id, startedAt, status, transportMode, routeGroupId, updatedAt',
  gpsPoints: 'id, tripId, &[tripId+sourceSeq], [tripId+sourceTimestamp]',
  tripEvents: 'id, tripId, [tripId+seq], [tripId+timestamp], type',
  routeGroups: 'id, name',
  recorderLease: 'name', // khóa một-tab dự phòng khi trình duyệt không có Web Locks API
});
```

`recorderLease`: `{ name, ownerId, expiresAt }`, gia hạn mỗi 5 s, coi là bỏ rơi sau 15 s không gia hạn (BR-01/FR-13 khi thiếu Web Locks).
