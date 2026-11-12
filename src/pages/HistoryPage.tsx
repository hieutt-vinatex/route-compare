import { useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { COPY } from '@/app/copy';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatPercent,
  QUALITY_LABELS,
  TRANSPORT_MODE_LABELS,
} from '@/app/format';
import {
  DEFAULT_HISTORY_FILTER,
  filterFromParams,
  filterToParams,
  filterTrips,
  HISTORY_STATUSES,
  isFilterActive,
  type HistoryFilter,
  type HistoryStatus,
} from '@/app/historyFilter';
import { RecoveryNotice } from '@/components/tracking/RecoveryNotice';
import { qualityTone } from '@/components/trip/quality';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { StatusPill } from '@/components/ui/StatusPill';
import { TRANSPORT_MODES, type Trip } from '@/domain/models/types';
import { useRecoverableTrip } from '@/hooks/useRecoverableTrip';
import { useTripList } from '@/hooks/useTrips';

const STATUS_LABELS: Readonly<Record<HistoryStatus, string>> = {
  ALL: 'Tất cả',
  COMPLETE: 'Đầy đủ',
  INCOMPLETE: 'Chưa đầy đủ',
  UNFINISHED: 'Chưa kết thúc',
};

const fieldClass =
  'block min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base';

/** FR-09 / docs/06 §5: search by name, filter by mode, local date range and status. */
export function HistoryPage() {
  const trips = useTripList();
  const recovery = useRecoverableTrip();
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(params), [params]);
  const visible = useMemo(
    () => (trips.status === 'ready' ? filterTrips(trips.data, filter) : []),
    [trips, filter],
  );
  const update = (patch: Partial<HistoryFilter>): void => {
    // flushSync: the router otherwise updates in a transition and the controlled input resets
    // mid-typing (caret jumps, keys lost — Telex/IME).
    setParams(filterToParams({ ...filter, ...patch }), { replace: true, flushSync: true });
  };
  const clear = (): void => {
    setParams(filterToParams(DEFAULT_HISTORY_FILTER), { replace: true, flushSync: true });
  };
  const ids = { q: useId(), mode: useId(), status: useId(), from: useId(), to: useId() };
  const hasTrips = trips.status === 'ready' && trips.data.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">Lịch sử</h1>
      <RecoveryNotice recovery={recovery} />
      {trips.status === 'loading' && <p className="text-sm text-slate-600">Đang tải…</p>}
      {trips.status === 'error' && <Notice tone="error">Không đọc được dữ liệu hành trình.</Notice>}
      {trips.status === 'ready' && trips.data.length === 0 && (
        <EmptyState
          title={COPY.noTrips}
          action={
            <Link to="/" className={buttonClass('primary')}>
              Bắt đầu hành trình
            </Link>
          }
        />
      )}

      {hasTrips && (
        <search aria-label="Lọc hành trình" className="block">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label htmlFor={ids.q} className="sr-only">
                Tìm theo tên
              </label>
              <input
                id={ids.q}
                type="search"
                value={filter.q}
                placeholder="Tìm theo tên…"
                onChange={(e) => {
                  update({ q: e.currentTarget.value });
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor={ids.mode} className="text-sm font-medium text-slate-700">
                Phương tiện
              </label>
              <select
                id={ids.mode}
                value={filter.mode}
                onChange={(e) => {
                  const mode = TRANSPORT_MODES.find((m) => m === e.currentTarget.value) ?? 'ALL';
                  update({ mode });
                }}
                className={fieldClass}
              >
                <option value="ALL">Tất cả</option>
                {TRANSPORT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {TRANSPORT_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.status} className="text-sm font-medium text-slate-700">
                Trạng thái
              </label>
              <select
                id={ids.status}
                value={filter.status}
                onChange={(e) => {
                  const status = HISTORY_STATUSES.find((s) => s === e.currentTarget.value) ?? 'ALL';
                  update({ status });
                }}
                className={fieldClass}
              >
                {HISTORY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={ids.from} className="text-sm font-medium text-slate-700">
                Từ ngày
              </label>
              <input
                id={ids.from}
                type="date"
                value={filter.from ?? ''}
                onChange={(e) => {
                  update({ from: e.currentTarget.value === '' ? null : e.currentTarget.value });
                }}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor={ids.to} className="text-sm font-medium text-slate-700">
                Đến ngày
              </label>
              <input
                id={ids.to}
                type="date"
                value={filter.to ?? ''}
                onChange={(e) => {
                  update({ to: e.currentTarget.value === '' ? null : e.currentTarget.value });
                }}
                className={fieldClass}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-sm text-slate-600" aria-live="polite">
              {visible.length} hành trình
            </p>
            {isFilterActive(filter) && (
              <Button variant="secondary" onClick={clear}>
                Xóa bộ lọc
              </Button>
            )}
          </div>
        </search>
      )}

      {hasTrips && visible.length === 0 && (
        <EmptyState
          title="Không có hành trình khớp bộ lọc."
          description="Thử từ khóa khác hoặc bỏ bớt điều kiện lọc."
        />
      )}
      {visible.length > 0 && (
        <ul className="space-y-2" data-testid="trip-list">
          {visible.map((t) => (
            <li key={t.id}>
              <TripRow trip={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripRow({ trip }: { readonly trip: Trip }) {
  const finished = trip.status === 'COMPLETED';
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="block space-y-1 rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:ring-teal-500"
    >
      <p className="font-semibold break-words text-slate-900">{trip.name}</p>
      <p className="text-sm text-slate-600">
        {formatDateTime(trip.startedAt)} · {TRANSPORT_MODE_LABELS[trip.transportMode]}
      </p>
      {finished ? (
        <>
          {/* The stored summary is only final after End (review I5). */}
          <p className="text-sm text-slate-700 tabular-nums">
            {formatDuration(trip.elapsedMs)} · {formatDistance(trip.distanceMeasuredM)} đo được · độ
            phủ {formatPercent(trip.coveragePct)}
          </p>
          <div className="flex flex-wrap gap-2">
            {trip.qualityLabel !== null && (
              <StatusPill
                live={false}
                tone={qualityTone(trip.qualityLabel)}
                label={`GPS: ${QUALITY_LABELS[trip.qualityLabel]}`}
              />
            )}
            {trip.isIncomplete && <StatusPill live={false} tone="warn" label="Chưa đầy đủ" />}
          </div>
        </>
      ) : (
        <StatusPill live={false} tone="info" label="Chưa kết thúc" />
      )}
    </Link>
  );
}
