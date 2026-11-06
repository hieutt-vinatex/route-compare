import type { GpsConfig } from '@/domain/models/gpsConfig';

const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** RT-302: how each Trip Detail number is computed (docs/05 §4–§8), thresholds from GpsConfig. */
export function FormulaNotes({ config }: { readonly config: GpsConfig }) {
  const { stop, quality } = config;
  return (
    <details
      className="rounded-xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200"
      data-testid="formula-notes"
    >
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-slate-900">
        Cách tính các số liệu
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>
          Quãng đường GPS đo được = tổng khoảng cách giữa các điểm GPS hợp lệ liên tiếp trong cùng
          một đoạn, sau khi lọc nhiễu. Không cộng qua khoảng mất GPS, trang bị ẩn hay tạm dừng.
        </li>
        <li>
          Tổng thời gian = Kết thúc − Bắt đầu. Tổng thời gian = Di chuyển + Dừng + Không xác định +
          Tạm dừng.
        </li>
        <li>
          Dừng: đứng yên ít nhất {integer.format(stop.dwellMs / 1000)} giây trong bán kính khoảng{' '}
          {integer.format(stop.radiusM)} m, tốc độ dưới {integer.format(stop.speedKmh)} km/h.
        </li>
        <li>
          Không xác định: lúc khởi động, mất GPS, trang bị ẩn hoặc chưa đủ bằng chứng — không được
          coi là dừng.
        </li>
        <li>TB toàn chuyến = Quãng đường GPS đo được ÷ Tổng thời gian.</li>
        <li>TB khi di chuyển = Quãng đường GPS đo được ÷ Thời gian di chuyển.</li>
        <li>
          Tốc độ cao nhất/thấp nhất: tốc độ đã làm mịn (trung vị), bỏ điểm nhiễu đơn lẻ; 0 km/h chỉ
          khi đã xác nhận dừng.
        </li>
        <li>Độ phủ GPS = (Di chuyển + Dừng) ÷ (Tổng thời gian − Tạm dừng).</li>
        <li>
          Chất lượng GPS: Tốt khi độ phủ ≥ {integer.format(quality.goodCoveragePct)} %, sai số trung
          vị ≤ {integer.format(quality.goodMedianAccuracyM)} m và không quá{' '}
          {integer.format(quality.goodMaxLargeGaps)} khoảng mất GPS lớn; Khá khi độ phủ ≥{' '}
          {integer.format(quality.fairCoveragePct)} %; còn lại là Thấp. Đây là ngưỡng thử nghiệm,
          chưa hiệu chỉnh thực địa.
        </li>
      </ul>
    </details>
  );
}
