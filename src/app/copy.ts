/** Vietnamese UI copy — docs/06-UI-UX.md §2, §3, §7. */
export const COPY = {
  platformHint:
    'Để ghi liên tục, giữ trang này hiển thị. Trình duyệt có thể ngừng GPS khi khóa màn hình.',
  platformDetail:
    'Trình duyệt không bảo đảm tiếp tục nhận GPS khi khóa màn hình hoặc chuyển sang ứng dụng khác. Khoảng thời gian đó được đánh dấu “không đo được” và không được cộng vào quãng đường.',
  wakeLockExplain:
    'Chỉ giữ màn hình sáng khi trang đang mở và hệ thống cho phép. Đây không phải chế độ chạy nền.',
  wakeLockUnsupported:
    'Trình duyệt này không hỗ trợ giữ màn hình sáng. Bạn có thể giữ trang hiển thị thủ công.',
  wakeLockFailed:
    'Thiết bị không cho phép giữ màn hình sáng. Bạn có thể giữ trang hiển thị thủ công.',
  permissionDenied:
    'Trình duyệt chưa được cấp quyền vị trí. Hãy bật quyền cho website trong cài đặt trình duyệt.',
  gpsUnavailable: 'Không xác định được vị trí. Vui lòng kiểm tra dịch vụ vị trí trên thiết bị.',
  gpsTimeout: 'Chưa nhận được vị trí. Hãy ra nơi thoáng hoặc thử lại.',
  insecureContext: 'Tính năng GPS yêu cầu website chạy qua HTTPS.',
  unsupported: 'Trình duyệt này không hỗ trợ định vị (Geolocation).',
  hiddenGap: 'Đã có khoảng thời gian không được đo. Quãng đường trong khoảng này không được cộng.',
  signalLost:
    'Thiếu tín hiệu GPS. Thời gian vẫn được tính nhưng quãng đường trong khoảng này không được cộng.',
  storageError:
    'Không thể lưu thêm điểm GPS. Dữ liệu mới có thể bị mất; hãy kiểm tra bộ nhớ và sao lưu.',
  internalError: 'Đã xảy ra lỗi khi xử lý dữ liệu GPS. Bạn vẫn có thể kết thúc chuyến.',
  noTrips: 'Chưa có hành trình. Bắt đầu chuyến đầu tiên để xem thống kê.',
  offlineMap: 'Không tải được nền bản đồ; dữ liệu hành trình đã lưu vẫn có thể xem.',
  offline:
    'Đang ở chế độ offline. Điểm GPS vẫn được ghi khi trang mở; nền bản đồ có thể không tải.',
  locationPrivacy:
    'Vị trí chỉ được xử lý trên thiết bị này, không gửi lên máy chủ. Nền bản đồ OpenStreetMap được tải theo khu vực bạn đang xem nên nhà cung cấp bản đồ có thể biết khu vực đó.',
  demoGps: 'GPS GIẢ LẬP (demo replay) — dữ liệu không phải đo thực tế.',
  safety: 'Chỉ thao tác khi đã dừng an toàn. Không cần bấm gì trong lúc điều khiển phương tiện.',
  gpsGap:
    'Đã có khoảng mất tín hiệu GPS lâu hơn 20 giây. Quãng đường trong khoảng này không được cộng.',
  interrupted: 'Việc ghi GPS đã bị gián đoạn (ví dụ quyền vị trí bị thu hồi).',
  noStartFix: 'Không có vị trí GPS hợp lệ lúc bắt đầu.',
  noEndFix: 'Không có vị trí GPS hợp lệ lúc kết thúc; điểm cuối không được suy đoán.',
  incompleteOther: 'Dữ liệu hành trình chưa đầy đủ.',
  tripInProgress:
    'Hành trình này chưa kết thúc. Số liệu chỉ được chốt khi bấm “Kết thúc” trên màn hình đang đo.',
  clockSkew:
    'Thời gian của nhiều mẫu GPS không khớp với đồng hồ thiết bị nên đang bị bỏ qua. Nếu tình trạng kéo dài, khi đã dừng an toàn hãy kiểm tra cài đặt ngày giờ tự động.',
  recorderBusy:
    'Đang có hành trình được ghi ở một tab khác của trình duyệt này. Mỗi thiết bị chỉ ghi một hành trình một lúc — hãy chuyển sang tab đó.',
  startBlockedRecovery:
    'Hãy tiếp tục hoặc kết thúc hành trình chưa kết thúc ở trên trước khi bắt đầu hành trình mới.',
  recoveryExplain:
    'Trang đã bị tải lại hoặc đóng khi hành trình đang ghi. Khoảng thời gian đó không được đo và không được cộng quãng đường.',
  paused:
    'Đang tạm dừng: GPS đã tắt. Thời gian tạm dừng được tính riêng, không cộng quãng đường. Bấm “Tiếp tục” khi đã dừng an toàn.',
  startTimeout:
    'Chưa nhận được vị trí đủ chính xác. Ứng dụng vẫn tiếp tục chờ; nơi thoáng đãng thường bắt GPS nhanh hơn.',
  measuredDistanceNote:
    'Chỉ tính các đoạn GPS liên tục đã đo được; không nối đường thẳng qua khoảng mất tín hiệu.',
} as const;

/** docs/06 §4 warning for a LOW-quality trip; X = minutes without measurement (≥ 1). */
export function lowGpsCopy(unknownMs: number): string {
  const minutes = Math.max(1, Math.round(unknownMs / 60_000));
  return `GPS thiếu dữ liệu trong ${minutes} phút; quãng đường hiển thị chỉ là phần đã đo được.`;
}
