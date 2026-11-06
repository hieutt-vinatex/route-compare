import { Link } from 'react-router';
import { COPY } from '@/app/copy';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  TRANSPORT_MODE_LABELS,
} from '@/app/format';
import { RecoveryNotice } from '@/components/tracking/RecoveryNotice';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { useRecoverableTrip } from '@/hooks/useRecoverableTrip';
import { useTripList } from '@/hooks/useTrips';

/** M1: plain list. Search/filters/recovery prompts arrive in M3 (FR-09). */
export function HistoryPage() {
  const trips = useTripList();
  const recovery = useRecoverableTrip();

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
      {trips.status === 'ready' && trips.data.length > 0 && (
        <ul className="space-y-2" data-testid="trip-list">
          {trips.data.map((t) => (
            <li key={t.id}>
              <Link
                to={`/trips/${t.id}`}
                className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:ring-teal-500"
              >
                <p className="font-semibold text-slate-900">{t.name}</p>
                <p className="text-sm text-slate-600">
                  {formatDateTime(t.startedAt)} · {TRANSPORT_MODE_LABELS[t.transportMode]} ·{' '}
                  {t.status === 'COMPLETED' ? (
                    <>
                      {formatDuration(t.elapsedMs)} · {formatDistance(t.distanceMeasuredM)} đo được
                      {t.isIncomplete ? ' · chưa đầy đủ' : ''}
                    </>
                  ) : (
                    // The stored summary is only final after End (review I5).
                    'đang ghi / chưa hoàn tất'
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
