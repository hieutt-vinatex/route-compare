import { useId } from 'react';
import { COPY } from '@/app/copy';
import type { WakeLockState } from '@/domain/trip/TrackingController';

/** FR-16 / AC-10: optional, hidden behind a support check, degrades gracefully. */
export function WakeLockToggle({
  state,
  onChange,
}: {
  state: WakeLockState;
  onChange: (wanted: boolean) => void;
}) {
  const id = useId();
  if (!state.supported) {
    return (
      <p data-testid="wakelock-unsupported" className="text-sm text-slate-600">
        {COPY.wakeLockUnsupported}
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3"
      >
        <span className="text-sm font-semibold text-slate-900">Giữ màn hình sáng</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="h-6 w-11 cursor-pointer accent-teal-700"
          checked={state.wanted}
          onChange={(e) => {
            onChange(e.currentTarget.checked);
          }}
        />
      </label>
      <p className="text-sm text-slate-600">{COPY.wakeLockExplain}</p>
      {state.wanted && state.active && (
        <p className="mt-1 text-sm font-medium text-emerald-800">Đang giữ màn hình sáng.</p>
      )}
      {state.wanted && state.failed && (
        <p
          role="alert"
          data-testid="wakelock-failed"
          className="mt-1 text-sm font-medium text-amber-900"
        >
          {COPY.wakeLockFailed}
        </p>
      )}
    </div>
  );
}
