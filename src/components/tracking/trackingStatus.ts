import type { Tone } from '@/components/ui/StatusPill';
import type { TrackingSnapshot } from '@/domain/trip/TrackingController';

/** docs/06 §3 status labels. Text + icon, never colour alone. */
export function trackingStatusPill(s: TrackingSnapshot): { tone: Tone; label: string } {
  switch (s.status) {
    case 'STARTING':
      return { tone: 'info', label: 'Đang chờ GPS để bắt đầu' };
    case 'FINALIZING':
      return { tone: 'info', label: 'Đang lưu hành trình' };
    case 'INTERRUPTED':
      return { tone: 'error', label: 'Đã gián đoạn ghi' };
    case 'PAUSED':
      return { tone: 'warn', label: 'Tạm dừng' };
    case 'RECORDING':
      switch (s.signal) {
        case 'OK':
          return { tone: 'recording', label: 'Đang ghi' };
        case 'ACQUIRING':
          return { tone: 'info', label: 'Đang ghi · đang lấy lại GPS' };
        case 'HIDDEN':
          return { tone: 'warn', label: 'Trang bị ẩn · không đo' };
        case 'ERROR':
        case 'LOST':
        case 'NONE':
          return { tone: 'warn', label: 'Thiếu tín hiệu GPS' };
      }
      break;
    case 'IDLE':
    case 'COMPLETED':
      break;
  }
  return { tone: 'neutral', label: 'Chưa ghi' };
}
