import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Notice } from '@/components/ui/Notice';
import type { Trip } from '@/domain/models/types';
import { normalizeTripName, TRIP_NAME_MAX } from '@/domain/trip/tripName';
import { useTripActions } from '@/hooks/useTripActions';

type Dialog = 'none' | 'rename' | 'delete';

/** Rename / delete a finished trip (docs/06 §4 actions, FR-14). Never shown while recording. */
export function TripActions({ trip }: { readonly trip: Trip }) {
  const { rename, remove } = useTripActions();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<Dialog>('none');
  const [name, setName] = useState(trip.name);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const valid = normalizeTripName(name) !== null;

  const close = (): void => {
    setDialog('none');
  };
  const run = (action: () => Promise<void>, failure: string): void => {
    setWorking(true);
    setError(null);
    void action()
      .catch(() => {
        setError(failure);
      })
      .finally(() => {
        setWorking(false);
      });
  };
  const save = (): void => {
    if (!valid || working) return;
    run(async () => {
      await rename(trip.id, name);
      close();
    }, 'Không đổi được tên hành trình. Hãy thử lại.');
  };
  const confirmDelete = (): void => {
    if (working) return;
    run(async () => {
      await remove(trip.id);
      close();
      await navigate('/history', { replace: true });
    }, 'Không xóa được hành trình. Dữ liệu vẫn còn nguyên; hãy thử lại.');
  };

  return (
    <section aria-label="Thao tác với hành trình" className="space-y-2">
      {error !== null && (
        <Notice tone="error" testId="trip-action-error">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setName(trip.name);
            setError(null);
            setDialog('rename');
          }}
        >
          Đổi tên
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setError(null);
            setDialog('delete');
          }}
        >
          Xóa hành trình
        </Button>
      </div>

      <ConfirmDialog
        open={dialog === 'rename'}
        title="Đổi tên hành trình"
        confirmLabel="Lưu"
        confirmDisabled={!valid || working}
        initialFocusRef={inputRef}
        onConfirm={save}
        onCancel={close}
      >
        <div className="mt-3 space-y-1">
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            Tên hành trình
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={name}
            maxLength={TRIP_NAME_MAX}
            onChange={(e) => {
              setName(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            className="block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Xóa hành trình này?"
        description="Toàn bộ điểm GPS và sự kiện của hành trình sẽ bị xóa khỏi thiết bị. Không thể hoàn tác."
        confirmLabel="Xóa"
        danger
        confirmDisabled={working}
        onConfirm={confirmDelete}
        onCancel={close}
      />
    </section>
  );
}
