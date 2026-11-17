import { useId, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import type { Trip } from '@/domain/models/types';
import { useTripActions } from '@/hooks/useTripActions';

/** FR-19: a manual label, independent of automatic A→B grouping. */
export function RouteVariantEditor({ trip }: { readonly trip: Trip }) {
  const { setRouteVariant } = useTripActions();
  const inputId = useId();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  if (trip.status !== 'COMPLETED') return null;

  const save = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (working) return;
    const label = new FormData(event.currentTarget).get('routeVariant');
    if (typeof label !== 'string') return;
    setWorking(true);
    setResult(null);
    void setRouteVariant(trip.id, label)
      .then(() => {
        setResult('saved');
      })
      .catch(() => {
        setResult('error');
      })
      .finally(() => {
        setWorking(false);
      });
  };

  return (
    <form onSubmit={save} className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        Phương án đường
      </label>
      <input
        key={`${trip.id}:${trip.routeVariantLabel ?? ''}`}
        id={inputId}
        name="routeVariant"
        type="text"
        defaultValue={trip.routeVariantLabel ?? ''}
        maxLength={120}
        disabled={working}
        aria-describedby={`${inputId}-help`}
        onChange={() => {
          setResult(null);
        }}
        className="block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base"
      />
      <p id={`${inputId}-help`} className="text-sm text-slate-600">
        Ví dụ: Qua đường A. Để trống để bỏ tên phương án đường.
      </p>
      <Button type="submit" variant="secondary" disabled={working}>
        Lưu phương án đường
      </Button>
      {result === 'saved' && <Notice>Đã lưu phương án đường.</Notice>}
      {result === 'error' && (
        <Notice tone="error">Không lưu được phương án đường. Hãy thử lại.</Notice>
      )}
    </form>
  );
}
