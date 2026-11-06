/** Display formatting (vi-VN). Missing values render as “—”, never as 0. */
import type { GpsError, QualityLabel, TransportMode, TripEventType } from '@/domain/models/types';
import { COPY } from './copy';

export const EMPTY_VALUE = '—';

const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const twoDecimals = new Intl.NumberFormat('vi-VN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Meters → “850 m” / “1,23 km”. */
export function formatDistance(meters: number | null | undefined): string {
  if (!isNumber(meters)) return EMPTY_VALUE;
  // Compare the rounded value so 999.6 m becomes “1,00 km”, not “1.000 m”.
  if (Math.round(meters) < 1000) return `${integer.format(meters)} m`;
  return `${twoDecimals.format(meters / 1000)} km`;
}

/** ms → “mm:ss” or “h:mm:ss”. */
export function formatDuration(ms: number | null | undefined): string {
  if (!isNumber(ms) || ms < 0) return EMPTY_VALUE;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatSpeedKmh(kmh: number | null | undefined): string {
  if (!isNumber(kmh)) return EMPTY_VALUE;
  return `${oneDecimal.format(kmh)} km/h`;
}

export function formatPercent(value: number | null | undefined): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  return `${integer.format(value)} %`;
}

/** docs/05 §8 heuristic labels, shown with the coverage they are based on. */
export const QUALITY_LABELS: Readonly<Record<QualityLabel, string>> = {
  GOOD: 'Tốt',
  FAIR: 'Khá',
  LOW: 'Thấp',
};

export function formatAccuracy(meters: number | null | undefined): string {
  if (!isNumber(meters)) return EMPTY_VALUE;
  return `±${integer.format(meters)} m`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Local device time “dd/mm/yyyy hh:mm”. Stored data stays UTC epoch ms. */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (!isNumber(epochMs)) return EMPTY_VALUE;
  const d = new Date(epochMs);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatTime(epochMs: number | null | undefined): string {
  if (!isNumber(epochMs)) return EMPTY_VALUE;
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function defaultTripName(epochMs: number): string {
  return `Hành trình • ${formatDateTime(epochMs)}`;
}

export const TRANSPORT_MODE_LABELS: Readonly<Record<TransportMode, string>> = {
  WALK: 'Đi bộ',
  BICYCLE: 'Xe đạp',
  MOTORBIKE: 'Xe máy',
  CAR: 'Ô tô',
};

export const EVENT_LABELS: Readonly<Record<TripEventType, string>> = {
  START: 'Bắt đầu',
  PAUSE: 'Tạm dừng',
  RESUME: 'Tiếp tục',
  END: 'Kết thúc',
  GPS_GAP_BEGIN: 'Bắt đầu mất GPS',
  GPS_GAP_END: 'Có lại GPS',
  GPS_ERROR: 'Lỗi GPS',
  PAGE_HIDDEN: 'Trang bị ẩn (không đo)',
  PAGE_VISIBLE: 'Trang hiển thị lại',
  WAKELOCK_ACQUIRED: 'Bật giữ màn hình sáng',
  WAKELOCK_RELEASED: 'Tắt giữ màn hình sáng',
  STORAGE_ERROR: 'Lỗi lưu trữ',
  RECOVERY: 'Khôi phục / tiếp tục ghi',
};

export function gpsErrorMessage(error: GpsError | null): string | null {
  if (error === null) return null;
  switch (error.code) {
    case 'PERMISSION_DENIED':
      return COPY.permissionDenied;
    case 'POSITION_UNAVAILABLE':
      return COPY.gpsUnavailable;
    case 'TIMEOUT':
      return COPY.gpsTimeout;
    case 'INSECURE_CONTEXT':
      return COPY.insecureContext;
    case 'UNSUPPORTED':
      return COPY.unsupported;
  }
}
