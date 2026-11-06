import { formatAccuracy } from '@/app/format';
import type { RejectCode } from '@/domain/models/types';
import type { TrackingSnapshot } from '@/domain/trip/TrackingController';

const REJECT_LABELS: Readonly<Record<RejectCode, string>> = {
  RANGE: 'tọa độ không hợp lệ',
  TIMESTAMP: 'thời gian bất thường',
  DUPLICATE: 'trùng lặp',
  STALE: 'mẫu cũ',
  ACCURACY: 'độ chính xác thấp',
  OUTLIER: 'đột biến',
  UNTRUSTED: 'chưa tin cậy (trang ẩn / hiệu chỉnh đồng hồ)',
};

/** Shows raw vs accepted counts and why samples were rejected (docs/05 §8). */
export function SampleQuality({ s }: { s: TrackingSnapshot }) {
  const rejected = Object.entries(s.rejectCounts) as [RejectCode, number][];
  return (
    <div
      className="rounded-xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200"
      data-testid="sample-quality"
    >
      <p>
        Mẫu GPS: <strong data-testid="accepted-count">{s.acceptedCount}</strong> hợp lệ /{' '}
        <strong data-testid="raw-count">{s.rawCount}</strong> nhận được · Đoạn GPS:{' '}
        <strong data-testid="segment-count">{s.segmentCount}</strong>
        {s.lastFix !== null && <> · Độ chính xác gần nhất {formatAccuracy(s.lastFix.accuracyM)}</>}
      </p>
      {rejected.length > 0 && (
        <p className="mt-1 text-sm text-slate-600">
          Bị loại: {rejected.map(([code, n]) => `${REJECT_LABELS[code]} ×${n}`).join(', ')}
        </p>
      )}
    </div>
  );
}
