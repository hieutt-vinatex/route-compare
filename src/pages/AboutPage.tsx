/**
 * Privacy, platform limits and attributions on one page (RT-503, FR-17, NFR-06).
 *
 * Everything here is a promise the app has to keep, so the copy comes from the same COPY constants
 * the recording screens use — one wording, one source.
 */
import { Link } from 'react-router';
import { COPY } from '@/app/copy';
import { TILE_ATTRIBUTION } from '@/components/map/tileConfig';
import { buttonClass } from '@/components/ui/buttonClass';
import { Notice } from '@/components/ui/Notice';

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-bold text-slate-900">Giới thiệu và quyền riêng tư</h1>

      <Section title="Giới hạn của trình duyệt">
        <Notice tone="warn" testId="about-platform-limit">
          {COPY.platformDetail}
        </Notice>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            RouteTrack chỉ ghi GPS khi <strong>trang đang hiển thị</strong>. Hãy mở app và giữ màn
            hình bật trong suốt hành trình.
          </li>
          <li>
            Tùy chọn “Giữ màn hình sáng” được bật sẵn. Nó chỉ giữ màn hình sáng khi trang đang mở —
            <strong> không</strong> phải chế độ chạy nền.
          </li>
          <li>
            Service Worker chỉ lưu đệm giao diện để mở offline. Nó <strong>không bao giờ</strong>{' '}
            truy cập GPS và không tải sẵn bản đồ nền.
          </li>
          <li>
            Thời gian Start→End luôn được đo đủ. Khoảng không đo được tính là{' '}
            <strong>“không xác định”</strong>, không phải “đang dừng”, và quãng đường trong khoảng
            đó không được cộng.
          </li>
        </ul>
      </Section>

      <Section title="Dữ liệu của bạn ở đâu">
        <p>{COPY.locationPrivacy}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Không có máy chủ, không có tài khoản, không có phân tích hành vi. Tọa độ{' '}
            <strong>không rời khỏi thiết bị</strong>.
          </li>
          <li>
            Dữ liệu nằm trong IndexedDB của trình duyệt. Xóa dữ liệu trang web, dùng chế độ ẩn danh
            hoặc gỡ trình duyệt sẽ <strong>mất hết</strong>.
          </li>
          <li>
            Hãy tải bản sao lưu JSON định kỳ ở trang Lịch sử. Đó là bản sao duy nhất bạn kiểm soát.
          </li>
        </ul>
        <Link to="/history" className={buttonClass('secondary')}>
          Tới sao lưu dữ liệu
        </Link>
      </Section>

      <Section title="Số liệu được tính thế nào">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            “Quãng đường GPS đo được” chỉ cộng các đoạn GPS liên tục. Không nối đường thẳng qua
            khoảng mất tín hiệu, tạm dừng hay lúc trang bị ẩn.
          </li>
          <li>
            Mọi ngưỡng lọc (độ chính xác 30 m, gap 20 s, dừng 2 km/h trong 15 s…) là{' '}
            <strong>heuristic chưa hiệu chỉnh thực địa</strong>, không phải chuẩn đo lường.
          </li>
          <li>
            Hai hành trình cùng điểm đi và điểm đến <strong>không</strong> có nghĩa là cùng một con
            đường.
          </li>
          <li>RouteTrack không có dữ liệu giao thông. Không suy đoán tắc đường từ tốc độ GPS.</li>
        </ul>
      </Section>

      <Section title="Bản quyền và nguồn">
        <p>Nền bản đồ: {TILE_ATTRIBUTION.replace(/<[^>]+>/g, '')}</p>
        <p>
          Dữ liệu bản đồ © những người đóng góp OpenStreetMap, theo giấy phép ODbL. RouteTrack chỉ
          tải ô bản đồ cho khu vực bạn đang xem.
        </p>
      </Section>
    </div>
  );
}
