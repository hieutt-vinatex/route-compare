import { useId, useMemo, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { COPY } from '@/app/copy';
import {
  defaultTripName,
  formatAccuracy,
  formatDateTime,
  formatDistance,
  TRANSPORT_MODE_LABELS,
} from '@/app/format';
import { LazyTrackMap } from '@/components/map/LazyTrackMap';
import type { MapPosition } from '@/components/map/trackMapTypes';
import { PlatformLimitNotice } from '@/components/tracking/PlatformLimitNotice';
import { RecoveryNotice } from '@/components/tracking/RecoveryNotice';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { MetricCard } from '@/components/ui/MetricCard';
import { Notice } from '@/components/ui/Notice';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { TRANSPORT_MODES, type TransportMode } from '@/domain/models/types';
import { useCurrentLocation, type LocationPreviewStatus } from '@/hooks/useCurrentLocation';
import { useRecorderBusy } from '@/hooks/useRecorderBusy';
import { useRecoverableTrip } from '@/hooks/useRecoverableTrip';
import { useServices } from '@/hooks/useServices';
import { useTracking } from '@/hooks/useTracking';
import { useTripList } from '@/hooks/useTrips';
import { useUiStore } from '@/stores/uiStore';

const GPS_PILL: Readonly<Record<LocationPreviewStatus, { tone: Tone; label: string }>> = {
  checking: { tone: 'neutral', label: 'GPS: Đang kiểm tra' },
  locating: { tone: 'info', label: 'GPS: Đang xác định' },
  ready: { tone: 'ok', label: 'GPS: Sẵn sàng' },
  'low-accuracy': { tone: 'warn', label: 'GPS: Độ chính xác thấp' },
  'needs-permission': { tone: 'warn', label: 'GPS: Chưa cấp quyền' },
  denied: { tone: 'error', label: 'GPS: Chưa cấp quyền' },
  unsupported: { tone: 'error', label: 'GPS: Không hỗ trợ' },
  insecure: { tone: 'error', label: 'GPS: Cần HTTPS' },
  unavailable: { tone: 'error', label: 'GPS: Không xác định được' },
  timeout: { tone: 'warn', label: 'GPS: Chưa nhận được vị trí' },
};

function LocationMessage({ status }: { status: LocationPreviewStatus }) {
  switch (status) {
    case 'denied':
      return (
        <Notice tone="error" testId="gps-denied">
          {COPY.permissionDenied}
        </Notice>
      );
    case 'unsupported':
      return <Notice tone="error">{COPY.unsupported}</Notice>;
    case 'insecure':
      return (
        <Notice tone="error" testId="gps-insecure">
          {COPY.insecureContext}
        </Notice>
      );
    case 'unavailable':
      return <Notice tone="error">{COPY.gpsUnavailable}</Notice>;
    case 'timeout':
      return <Notice tone="warn">{COPY.gpsTimeout}</Notice>;
    case 'needs-permission':
      return (
        <Notice tone="info" title="Cho phép truy cập vị trí">
          RouteTrack chỉ xin quyền vị trí khi bạn bấm nút bên dưới. {COPY.locationPrivacy}
        </Notice>
      );
    case 'checking':
    case 'locating':
    case 'ready':
    case 'low-accuracy':
      return null;
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const { tracker, clock, config } = useServices();
  const preview = useCurrentLocation();
  const tracking = useTracking();
  const trips = useTripList();
  const recorderBusy = useRecorderBusy();
  const recovery = useRecoverableTrip();
  // BR-01: one trip at a time — an unfinished trip must be resumed or ended first.
  const blockedByRecovery = recovery.trip !== null;
  const { transportMode, tripName, setTransportMode, setTripName } = useUiStore();
  const modeId = useId();
  const nameId = useId();

  const current = useMemo<MapPosition | null>(
    () =>
      preview.fix === null
        ? null
        : {
            lat: preview.fix.latitude,
            lng: preview.fix.longitude,
            accuracyM: preview.fix.accuracyM,
            accepted: preview.status === 'ready',
          },
    [preview.fix, preview.status],
  );

  const completed =
    trips.status === 'ready' ? trips.data.filter((t) => t.status === 'COMPLETED') : [];
  const totalMeasured = completed.reduce((sum, t) => sum + t.distanceMeasuredM, 0);
  const latest = completed[0];
  const active = tracking.status !== 'IDLE';
  const pill = GPS_PILL[preview.status];
  const canLocate = preview.status !== 'unsupported' && preview.status !== 'insecure';

  const onStart = (e: SubmitEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!preview.hasValidFix || active || recorderBusy || blockedByRecovery) return;
    const name = tripName.trim() === '' ? defaultTripName(clock.now()) : tripName.trim();
    void tracker.start({ name, transportMode });
    setTripName('');
    void navigate('/tracking');
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Ghi hành trình</h1>
        <StatusPill tone={pill.tone} label={pill.label} testId="gps-status" />
      </div>

      <RecoveryNotice recovery={recovery} />
      <PlatformLimitNotice />
      <LocationMessage status={preview.status} />

      <section aria-labelledby="home-location" className="space-y-2">
        <h2 id="home-location" className="sr-only">
          Vị trí hiện tại
        </h2>
        <LazyTrackMap
          segments={[]}
          current={current}
          className="h-56 sm:h-72"
          ariaLabel="Bản đồ vị trí hiện tại"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700" data-testid="home-accuracy">
            {preview.fix !== null
              ? `Độ chính xác: ${formatAccuracy(preview.fix.accuracyM)}`
              : 'Chưa có vị trí.'}
          </p>
          {canLocate && (
            <Button
              variant="secondary"
              onClick={preview.locate}
              disabled={preview.status === 'locating'}
            >
              {preview.fix === null ? 'Xác định vị trí của tôi' : 'Làm mới vị trí'}
            </Button>
          )}
        </div>
        {preview.status === 'low-accuracy' && (
          <p className="text-sm text-amber-900">
            Độ chính xác hiện tại thấp. Khi bắt đầu, ứng dụng sẽ chờ GPS đạt ±{config.maxAccuracyM}{' '}
            m mới lấy điểm xuất phát.
          </p>
        )}
      </section>

      {active ? (
        <Notice
          tone="warn"
          title="Đang có hành trình đang ghi"
          testId="active-trip-notice"
          action={
            <Link to="/tracking" className={buttonClass('primary')}>
              Mở màn hình đang đo
            </Link>
          }
        >
          Chỉ một hành trình được ghi tại một thời điểm.
        </Notice>
      ) : (
        <form
          onSubmit={onStart}
          className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={modeId} className="text-sm font-semibold text-slate-900">
                Phương tiện
              </label>
              <select
                id={modeId}
                value={transportMode}
                onChange={(e) => {
                  setTransportMode(e.currentTarget.value as TransportMode);
                }}
                className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
              >
                {TRANSPORT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {TRANSPORT_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={nameId} className="text-sm font-semibold text-slate-900">
                Tên hành trình (không bắt buộc)
              </label>
              <input
                id={nameId}
                type="text"
                value={tripName}
                maxLength={120}
                placeholder={defaultTripName(clock.now())}
                onChange={(e) => {
                  setTripName(e.currentTarget.value);
                }}
                className="block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-base"
              />
            </div>
          </div>
          {recorderBusy && (
            <Notice tone="warn" testId="recorder-busy">
              {COPY.recorderBusy}
            </Notice>
          )}
          {blockedByRecovery && !recorderBusy && (
            <Notice tone="warn" testId="start-blocked-recovery">
              {COPY.startBlockedRecovery}
            </Notice>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!preview.hasValidFix || recorderBusy || blockedByRecovery}
          >
            Bắt đầu ghi hành trình
          </Button>
          {!preview.hasValidFix && (
            <p className="text-center text-sm text-slate-600">
              Cần xác định vị trí trước khi bắt đầu.
            </p>
          )}
          <p className="text-center text-sm text-slate-500">{COPY.safety}</p>
        </form>
      )}

      <section aria-labelledby="home-summary" className="space-y-2">
        <h2 id="home-summary" className="text-base font-semibold text-slate-900">
          Tổng quan
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MetricCard label="Số chuyến" value={String(completed.length)} />
          <MetricCard label="Quãng đường GPS đo được" value={formatDistance(totalMeasured)} />
          <MetricCard
            label="Lần gần nhất"
            value={latest === undefined ? '—' : formatDateTime(latest.startedAt)}
          />
        </div>
      </section>

      <p className="text-sm text-slate-500">{COPY.locationPrivacy}</p>
    </div>
  );
}
