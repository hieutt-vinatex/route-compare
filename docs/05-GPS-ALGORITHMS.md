# 05. GPS Processing, distance, time, speed và chất lượng dữ liệu

**Đây là phần business-critical.** Mọi công thức phải có unit test và dữ liệu replay. Không tính toán metric chỉ bằng `coords.speed` hay tổng khoảng cách nối toàn bộ raw points.

## 1. Dữ liệu vị trí, đơn vị và API

- Call `navigator.geolocation.watchPosition(onSuccess, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })`. Đây là đề xuất ban đầu, không phải cam kết browser trả mẫu mỗi X giây.
- `GeolocationPosition.timestamp` là epoch ms; `coords.latitude`, `longitude` degrees WGS84; `accuracy` meters; `speed` meters/second hoặc `null`; `heading` có thể `null`.
- `maximumAge: 0` yêu cầu điểm mới khi có thể; browser vẫn phụ thuộc GPS/radio/OS. Các mức ngưỡng bên dưới là **heuristic configurable** để field test, không phải tiêu chuẩn độ chính xác tuyệt đối.
- `visibilitychange` & `pageshow/pagehide` được sử dụng để ghi event. Không phụ thuộc `beforeunload` để lưu dữ liệu cuối cùng.
- `Screen Wake Lock` yêu cầu khi user bật tùy chọn; giải phóng khi rời tracking/kết thúc; nếu được release tự động thì yêu cầu lại khi visible nếu user vẫn muốn.

## 2. Pipeline

```
Position callback
  -> normalize + raw persist
  -> check timestamp validity, bounds and duplicate
  -> accuracy gate / outlier gate (with reasons)
  -> detect time gap & visibility boundaries
  -> append accepted point into a segment (or start new segment)
  -> classify interval MOVING/STOPPED/UNKNOWN
  -> update stats from accepted segments + events
  -> update live UI on throttled schedule
```

**Critical:** Nếu callback nhận điểm thô nhưng write IndexedDB thất bại, không được coi dữ liệu đã an toàn. Hiển thị STORAGE_ERROR; cho phép user kết thúc và thử xuất bản sao tạm nếu có.

## 3. Điều kiện hợp lệ và filter

1. `lat ∈ [-90,90]`, `lon ∈ [-180,180]`, timestamp hữu hạn; `accuracy > 0` nếu provider cung cấp.
2. Không cộng điểm có timestamp không tăng hoặc trùng mẫu; lưu raw với `rejectCode`.
3. Mẫu có `accuracy > 30m` mặc định đánh dấu LOW_ACCURACY và có thể chờ mẫu tốt hơn; ngưỡng 30m cần cấu hình riêng theo mode/điều kiện thực tế.
4. Nếu `dt = sourceTimestamp[i]-sourceTimestamp[i-1] > 20s` mặc định: kết thúc segment trước, mở gap; mẫu mới bắt đầu segment sau, không cộng đoạn nối.
5. Nếu `visibilityState` chuyển sang hidden, đánh dấu boundary; khi visible lại, start segment mới dù khoảng gap nhỏ; không chốt rằng vẫn ghi GPS trong khi hidden.
6. Nếu dist/dt tạo speed cao bất thường, đánh dấu OUTLIER và đối chiếu accuracy, các mẫu lân cận. Ví dụ ngưỡng cảnh báo mặc định `WALK 12`, `BICYCLE 65`, `MOTORBIKE 150`, `CAR 180` km/h. Chúng là bộ lọc kỹ thuật khởi tạo, **không phải chỉ dẫn tốc độ an toàn/giới hạn pháp luật**; không áp dụng cứng cho mọi môi trường mà không hiệu chỉnh.
7. GPS drift khi đứng yên: dùng spatial radius/dwell và uncertainty để tránh tính nhiễu thành quãng đường. Không cộng các bước rất nhỏ so với độ chính xác.

## 4. Khoảng cách Haversine

Với hai vị trí được chấp nhận trong **cùng segment**:

```text
R = 6,371,000 meters
lat1,lat2,lon1,lon2 in radians
dLat = lat2 - lat1
dLon = lon2 - lon1
a = sin(dLat/2)^2 + cos(lat1)*cos(lat2)*sin(dLon/2)^2
dMeters = 2*R*atan2(sqrt(a), sqrt(1-a))
```

`distanceMeasuredM = sum(dMeters)` trên các cặp hợp lệ, liên tục, thuộc cùng segment và đã qua drift filter. Khoảng GPS gap có `distanceUnknown`, không phải distance=0, không phải straight-line bridge.

## 5. Phân hoạch thời gian

Gọi `tripElapsedMs = endedAt - startedAt`.

- `pausedMs`: hợp các interval user PAUSED; không chồng lặp.
- `knownMs`: interval giữa các GPS mẫu chấp nhận **trong cùng segment**, chưa pause và không vượt `maxGapMs`, đủ điều kiện phân loại.
- `movingMs`: phần `knownMs` được xác nhận chuyển động.
- `stoppedMs`: phần `knownMs` xác nhận đứng yên sau dwell.
- `unknownMs = tripElapsedMs - pausedMs - movingMs - stoppedMs` (giới hạn không âm); bao gồm khởi động, mất GPS, ẩn tab và interval không đủ chứng cứ.
- Bảo đảm `tripElapsedMs ≈ pausedMs + movingMs + stoppedMs + unknownMs` trong test (chấp nhận rounding ≤ 1 ms).

Một đoạn GPS có tốc độ tức thời thấp nhưng chưa đủ thời gian dwell phải được giữ UNKNOWN cho đến khi có xác nhận; không mặc định STOPPED. `elapsedMs` luôn tính từ timestamp Start→End, nên thời gian vẫn đo được ngay cả khi GPS thiếu.

## 6. Xác nhận dừng/di chuyển

Đề xuất bước đầu:

- Ngưỡng tốc độ thấp `2 km/h`, dwell tối thiểu `15 s`, dịch chuyển trong bán kính ~20 m đã điều chỉnh theo accuracy.
- Tổ hợp nhiều mẫu liên tiếp cần dùng để xác nhận STOPPED; khi speed `null`, dùng displacement/dt của accepted points.
- Không xem pause thủ công là stopped; pause nằm ở `pausedMs`.
- Nếu thiếu GPS, trạng thái là UNKNOWN, không khẳng định đang dừng hay chạy.

## 7. Công thức speed

- `vSegmentMps = distanceBetweenAcceptedPointsM / deltaSeconds`, chỉ khi `deltaSeconds > 0`, không gap.
- `avgElapsedKmh = distanceMeasuredM / elapsedSeconds * 3.6`, với elapsedSeconds > 0; nhãn UI **“TB theo toàn chuyến (dựa trên GPS đo được)”** nếu quality thấp.
- `avgMovingKmh = distanceMeasuredM / movingSeconds * 3.6` nếu movingSeconds > 0; trong thực tế distance khi stopped đã được loại drift.
- `maxSpeedKmh`: tốc độ lớn nhất của các interval hợp lệ sau median smoothing (e.g. cửa sổ 3); chỉ report khi sample count đủ và không bị nhiễu. Không dùng spike raw `coords.speed` duy nhất.
- `minSpeedKmh = 0` khi có stopped được xác nhận; nếu không có stopped, dùng min positive smoothed moving speed; nếu thiếu dữ liệu thì `null` (UI hiển thị `—`).
- Thêm optional `p95SpeedKmh` để giải thích outlier; không dùng tốc độ max duy nhất để kết luận về đường nhanh/chậm.

## 8. Data completeness / quality

`coveragePct = 100 * (movingMs + stoppedMs)/(elapsedMs - pausedMs)` khi denominator > 0, ngược lại `null`.

Quality label (heuristic phiên bản 1, cần field calibration):

| Level | Rule khởi tạo |
|---|---|
| GOOD | coverage ≥90%, median accepted accuracy ≤25m, ≤2 gaps lớn |
| FAIR | coverage ≥70% nhưng không đạt GOOD |
| LOW | Còn lại hoặc dữ liệu quá ít |

Không so sánh chất lượng trip chỉ bằng số điểm; tốc độ callback của browser không do app kiểm soát. Luôn hiển thị `coveragePct`, total gap seconds, accepted/raw point counts. `isIncomplete=true` khi bị gián đoạn lớn, thiếu start/end GPS, hoặc COMPLETED từ RECOVERY bất thường.

## 9. Điểm đầu/cuối, grouping và direction

- Dùng GPS accepted đầu và cuối (không dùng raw không hợp lệ).
- Gợi ý 2 trip cùng origin/destination khi distances giữa originA-originB và destA-destB không vượt 150m, đồng thời mode trùng; reverse B→A là nhóm khác.
- **Không** tự gắn cùng đường/variant chỉ vì cùng endpoints. Route variant thủ công trong MVP; phase sau dùng map matching + similarity.

## 10. Pseudocode quan trọng

```ts
async function onGpsSample(raw: RawGpsSample) {
  // 1. Persist raw before relying on the sample.
  await repository.appendRawPoint(raw);
  const result = filterSample(raw, previousAccepted, config);
  await repository.recordProcessingResult(raw.id, result);
  if (!result.accepted) return;

  const crossesBoundary = wasPageHidden || isPaused ||
    !previousAccepted ||
    raw.timestamp - previousAccepted.timestamp > config.maxGapMs;

  if (crossesBoundary) {
    await repository.startGpsSegment(tripId, raw.timestamp);
    await repository.appendEvent({ type: 'GPS_GAP_END', timestamp: raw.timestamp });
    previousAccepted = raw;
    return; // no bridging distance across segment boundary
  }

  const meters = haversine(previousAccepted, raw);
  await repository.appendAcceptedEdge(tripId, previousAccepted, raw, meters);
  previousAccepted = raw;
  scheduleUiRefresh();
}
```

Pseudocode chỉ diễn giải logic; cần implement await/queue/transaction đúng để không có race khi callback dồn và không có side-effect không được await.

## 11. Replay fixtures bắt buộc

- STATIONARY: 5 phút đứng yên với GPS jitter, distance gần 0, stopped được xác nhận.
- STRAIGHT: đường thẳng với timestamp ổn định, distance đúng Haversine ± rounding.
- NOISE: đột biến 1km trong 2s → reject outlier.
- GAP: mẫu A rồi 90s sau mẫu B → `unknownMs` tăng, không cộng A→B.
- PAGE_HIDDEN: hidden/visible liên tiếp → hai segment, no bridging.
- PAUSE: pause trong 120s → pausedMs đúng, không cộng distance.
- SPEED_NULL: coords.speed=null → derived speed vẫn tính được.
- CLOCK_ERROR: điểm timestamp đảo ngược hoặc trùng → reject, không crash.
- END_WITHOUT_FIX: kết thúc sau mất GPS → no fabricated endpoint, report incomplete.
- BROWSER_RELOAD: trip live persisted, resume in new segment, not retroactive track.

## 12. Ghi chú triển khai M2 (06/11/2026)

Bổ sung chi tiết đã hiện thực trong `src/domain/geo/trackProcessor.ts` và `src/domain/analytics/*`. Các ngưỡng vẫn là heuristic cấu hình được (`src/domain/models/gpsConfig.ts`).

- **Mô hình độ lệch đồng hồ (CLOCK_ERROR):** `offset = recordedAt − sourceTimestamp`; tham chiếu = median của 5 mẫu gần nhất. Mẫu lệch khỏi tham chiếu quá ±5 s bị loại (`TIMESTAMP` nếu “ở tương lai”, `STALE` nếu cũ) và **không** trở thành mốc thứ tự. Đồng hồ thiết bị lệch cố định không chặn việc ghi. Khi đa số mẫu chuyển sang mức lệch mới (đồng hồ bị chỉnh), đoạn hiện tại đóng lại, đoạn mới bắt đầu, không nối. Mẫu đầu tiên của mỗi chuyến chỉ dùng để hiệu chỉnh (`UNTRUSTED`).
- **Gap trên hai đồng hồ:** ngắt đoạn khi `max(Δ sourceTimestamp, Δ recordedAt) > maxGapMs`.
- **OUTLIER (§3.6):** loại cạnh nếu `max(0, d − accA − accB) / dt` vượt giới hạn của phương tiện (12/65/150/180 km/h). Một chuỗi bị loại không kéo dài mãi: sau `maxGapMs` không có điểm hợp lệ, điểm kế tiếp mở đoạn mới.
- **Drift (§3.7):** quãng đường cộng từ một “điểm neo” khi `d ≥ max(2 m, √(accNeo² + accFix²))`, rồi neo dời tới điểm mới; phần dư nhỏ hơn sai số ở cuối đoạn bị bỏ.
- **Bằng chứng tốc độ khi phân loại (§6, sửa sau review C1):** `coords.speed` nếu thiết bị báo; nếu không, tốc độ của “bước neo” của bộ lọc drift (quãng dời đã vượt sai số ÷ thời gian giữa hai neo). Dời còn trong phạm vi sai số **không** được coi là 0 km/h mà là chưa có bằng chứng (UNKNOWN).
- **Xác nhận dừng (§6):** STOPPED khi tồn tại cửa sổ ≥ 15 s mà mọi điểm nằm trong `max(20 m, accuracy trung vị)` quanh tâm cửa sổ **và** tốc độ ròng (tâm 1/3 đầu → tâm 1/3 cuối) < 2 km/h. Lần dừng ngắn hơn 15 s không bao giờ là STOPPED; khi có `coords.speed` nó là UNKNOWN, khi không có thì có thể được tính như di chuyển chậm (giới hạn của độ chính xác GPS).
- **Tốc độ cao nhất/thấp nhất/p95 (§7):** tốc độ theo từng điểm đo trên nền ≥ 5 s đã vượt sai số (hoặc `coords.speed`), lấy median cửa sổ 5 cạnh và **chỉ cửa sổ đầy đủ** — một điểm nhiễu, kể cả ở đầu/cuối đoạn, không thành giá trị cực đại. Chuyến quá ngắn cho cửa sổ đầy đủ hiển thị “—”.
- **Phân hoạch thời gian (§5):** thời lượng cạnh tính theo `recordedAt` (cùng đồng hồ với `elapsed` và tạm dừng) nên `elapsed = moving + stopped + paused + unknown` chính xác kể cả khi đồng hồ GPS lệch.
- **Chất lượng (§8):** dưới `quality.minAcceptedFixes` (10) điểm hợp lệ → LOW (“dữ liệu quá ít”); max/min/p95 chỉ báo khi có ít nhất `minSpeedStatEdges` (3) cạnh MOVING có tốc độ thống kê — cả hai nằm trong `GpsConfig`. `isIncomplete` khi: không có điểm đầu, không có điểm cuối (đoạn không đo ở cuối > 20 s), bất kỳ khoảng không đo > 20 s, bất kỳ lần trang bị ẩn **ngoài** thời gian tạm dừng, đồng hồ bị chỉnh, mất quyền/khôi phục sau reload, lỗi lưu trữ. Tạm dừng (kể cả khóa màn hình trong lúc tạm dừng) không làm chuyến “chưa đầy đủ”.
- **Mất quyền khi đang tạm dừng:** chuyến vẫn ở trạng thái tạm dừng (GPS đã tắt); khi bấm Tiếp tục, GPS được xin lại và báo lỗi rõ nếu vẫn bị từ chối.
- **Tốc độ hiện tại (UI):** ưu tiên `coords.speed`. Nếu thiết bị không báo: hiện `0` **chỉ khi** 15 s gần nhất xác nhận dừng (gọn + chậm như §6, BR-07); còn lại là median tại 3 điểm cuối của tốc độ độ-dời **vượt sai số vị trí** (cơ sở ≤ 5 s, lùi xa tới 60 s khi đi chậm). Độ dời còn trong sai số → `—`, không phải 0. Trong ~3 s đầu mỗi đoạn có thể bị một điểm nhiễu kéo lên (giới hạn đã biết).
