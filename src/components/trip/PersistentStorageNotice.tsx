import { useEffect, useState } from 'react';
import {
  readPersistence,
  requestPersistence,
  type PersistenceStatus,
} from '@/adapters/storage/persistence';
import { Button } from '@/components/ui/Button';
import { useRecorderBusy } from '@/hooks/useRecorderBusy';
import { useTracking } from '@/hooks/useTracking';

const STATUS_TEXT: Record<PersistenceStatus, string> = {
  persistent: 'Đã được cấp lưu trữ bền vững trên thiết bị này.',
  'best-effort': 'Dữ liệu đang được lưu theo chính sách thông thường của trình duyệt.',
  denied: 'Trình duyệt chưa cấp lưu trữ bền vững. Hãy tải bản sao lưu JSON định kỳ.',
  unsupported:
    'Trình duyệt không hỗ trợ yêu cầu lưu trữ bền vững. Hãy tải bản sao lưu JSON định kỳ.',
  error:
    'Không kiểm tra hoặc yêu cầu được lưu trữ bền vững. Hãy thử lại hoặc tải bản sao lưu JSON.',
};

export function PersistentStorageNotice() {
  const [status, setStatus] = useState<PersistenceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { status: trackingStatus } = useTracking();
  const otherRecorder = useRecorderBusy();
  const recording = otherRecorder || !['IDLE', 'COMPLETED'].includes(trackingStatus);

  useEffect(() => {
    let cancelled = false;
    void readPersistence().then((value) => {
      if (!cancelled) setStatus(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2 text-sm text-slate-600">
      <p role="status">{status === null ? 'Đang kiểm tra lưu trữ…' : STATUS_TEXT[status]}</p>
      <p>
        Lưu trữ bền vững không bảo đảm lưu vĩnh viễn; xóa dữ liệu trang vẫn xóa hành trình. Bản sao
        lưu JSON vẫn cần thiết.
      </p>
      {status !== null && status !== 'persistent' && status !== 'unsupported' && (
        <Button
          variant="secondary"
          disabled={busy || recording}
          onClick={() => {
            if (recording || busy) return;
            setBusy(true);
            void requestPersistence()
              .then(setStatus)
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? 'Đang yêu cầu…' : 'Yêu cầu giữ dữ liệu trên thiết bị'}
        </Button>
      )}
      {recording && <p>Chỉ yêu cầu lưu trữ sau khi kết thúc hành trình và đã dừng an toàn.</p>}
    </div>
  );
}
