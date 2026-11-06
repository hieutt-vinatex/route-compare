import { useState } from 'react';
import { useNavigate } from 'react-router';
import { COPY } from '@/app/copy';
import { formatDateTime } from '@/app/format';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import type { RecoverableTrip } from '@/hooks/useRecoverableTrip';
import { useServices } from '@/hooks/useServices';

/**
 * UC-08: an unfinished trip was found after a reload. The closed period is never filled in;
 * the user chooses to continue (new segment) or end it as incomplete. The page owns the lookup
 * (useRecoverableTrip) so it can also block Start while a trip waits (BR-01).
 */
export function RecoveryNotice({ recovery }: { readonly recovery: RecoverableTrip }) {
  const { trip, refresh } = recovery;
  const { tracker } = useServices();
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);
  if (trip === null) return null;
  const hasStartFix = trip.startLat !== null;

  const run = (action: () => Promise<void>): void => {
    setWorking(true);
    void action().finally(() => {
      setWorking(false);
    });
  };

  return (
    <Notice
      tone="warn"
      testId="recovery-notice"
      title="Có hành trình chưa kết thúc"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={working}
            onClick={() => {
              run(async () => {
                await tracker.resumeRecovered(trip.id);
                await navigate('/tracking');
              });
            }}
          >
            {hasStartFix ? 'Tiếp tục ghi (đoạn mới)' : 'Tiếp tục chờ GPS'}
          </Button>
          {hasStartFix ? (
            <Button
              variant="secondary"
              disabled={working}
              onClick={() => {
                run(async () => {
                  const id = await tracker.endRecovered(trip.id);
                  if (id !== null) await navigate(`/trips/${id}`);
                  else refresh();
                });
              }}
            >
              Kết thúc (chưa đầy đủ)
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={working}
              onClick={() => {
                run(async () => {
                  await tracker.discardRecovered(trip.id);
                  refresh();
                });
              }}
            >
              Hủy hành trình
            </Button>
          )}
        </div>
      }
    >
      <strong>{trip.name}</strong> — bắt đầu {formatDateTime(trip.startedAt)}.{' '}
      {COPY.recoveryExplain}
    </Notice>
  );
}
