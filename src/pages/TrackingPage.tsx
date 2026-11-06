import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { COPY } from '@/app/copy';
import { formatDistance, formatDuration, formatSpeedKmh, gpsErrorMessage } from '@/app/format';
import { LazyTrackMap } from '@/components/map/LazyTrackMap';
import type { MapPosition } from '@/components/map/trackMapTypes';
import { PlatformLimitNotice } from '@/components/tracking/PlatformLimitNotice';
import { RecoveryNotice } from '@/components/tracking/RecoveryNotice';
import { SampleQuality } from '@/components/tracking/SampleQuality';
import { trackingStatusPill } from '@/components/tracking/trackingStatus';
import { WakeLockToggle } from '@/components/tracking/WakeLockToggle';
import { Button } from '@/components/ui/Button';
import { buttonClass } from '@/components/ui/buttonClass';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { MetricCard } from '@/components/ui/MetricCard';
import { Notice } from '@/components/ui/Notice';
import { StatusPill } from '@/components/ui/StatusPill';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServices } from '@/hooks/useServices';
import { useTracking } from '@/hooks/useTracking';
import { useUiStore } from '@/stores/uiStore';

export function TrackingPage() {
  const s = useTracking();
  const { tracker, config } = useServices();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [follow, setFollow] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const {
    showAccuracyCircle,
    setShowAccuracyCircle,
    dismissedHiddenNoticeAt,
    dismissHiddenNotice,
  } = useUiStore();

  const current = useMemo<MapPosition | null>(
    () =>
      s.lastFix === null
        ? null
        : {
            lat: s.lastFix.lat,
            lng: s.lastFix.lng,
            accuracyM: s.lastFix.accuracyM,
            accepted: s.lastFix.accepted,
          },
    [s.lastFix],
  );

  if (s.status === 'IDLE') {
    const error = gpsErrorMessage(s.gpsError);
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl font-bold text-slate-900">Đang đo</h1>
        {error !== null && (
          <Notice tone="error" testId="tracking-error">
            {error}
          </Notice>
        )}
        {s.storageError && <Notice tone="error">{COPY.storageError}</Notice>}
        {s.recorderBusy && (
          <Notice tone="warn" testId="recorder-busy">
            {COPY.recorderBusy}
          </Notice>
        )}
        <RecoveryNotice />
        <EmptyState
          title="Chưa có hành trình đang ghi"
          description="Bắt đầu một hành trình từ trang chủ."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/" className={buttonClass('primary')}>
                Về trang chủ
              </Link>
              {s.lastCompletedTripId !== null && (
                <Link to={`/trips/${s.lastCompletedTripId}`} className={buttonClass('secondary')}>
                  Xem chuyến vừa kết thúc
                </Link>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const pill = trackingStatusPill(s);
  const hiddenNotice =
    s.lastHiddenInterval !== null && s.lastHiddenInterval.to !== dismissedHiddenNoticeAt
      ? s.lastHiddenInterval
      : null;
  const gpsError = gpsErrorMessage(s.gpsError);
  const lostSignal = s.status === 'RECORDING' && (s.signal === 'LOST' || s.signal === 'ERROR');
  // Timestamp-related rejections dominating → most likely a device clock problem (review I2).
  const clockRejects = (s.rejectCounts.TIMESTAMP ?? 0) + (s.rejectCounts.STALE ?? 0);
  const clockTrouble = clockRejects >= 5 && clockRejects * 2 >= s.rawCount;

  const finish = async (): Promise<void> => {
    setConfirmEnd(false);
    const id = await tracker.end();
    if (id !== null) void navigate(`/trips/${id}`);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="truncate text-lg font-bold text-slate-900">{s.tripName}</h1>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={pill.tone} label={pill.label} testId="tracking-status" />
          {!online && <StatusPill tone="neutral" label="Đang ở chế độ offline" />}
        </div>
      </div>

      <div className="relative">
        <LazyTrackMap
          segments={s.track.segments}
          trackVersion={s.track.version}
          current={current}
          startPoint={s.startPoint}
          showAccuracy={showAccuracyCircle}
          follow={follow}
          onUserMovedMap={() => {
            setFollow(false);
          }}
          className="h-[60dvh] min-h-64"
          ariaLabel="Bản đồ hành trình đang ghi"
        />
        <div className="absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-2">
          {!follow && (
            <Button
              variant="secondary"
              onClick={() => {
                setFollow(true);
              }}
              className="shadow-md"
            >
              <Icon name="crosshair" /> Theo vị trí
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-600">{COPY.measuredDistanceNote}</p>

      <section
        aria-label="Chỉ số hành trình"
        className="sticky top-0 z-10 -mx-3 grid grid-cols-2 gap-2 bg-slate-50/95 px-3 py-2 sm:mx-0 sm:grid-cols-4 sm:px-0"
      >
        <MetricCard
          label="Quãng đường GPS đo được"
          value={formatDistance(s.distanceMeasuredM)}
          testId="metric-distance"
        />
        <MetricCard
          label="Tổng thời gian"
          value={formatDuration(s.elapsedMs)}
          testId="metric-elapsed"
        />
        <MetricCard
          label="Tốc độ hiện tại"
          value={formatSpeedKmh(s.currentSpeedKmh)}
          testId="metric-speed"
        />
        <MetricCard
          label="TB toàn chuyến"
          value={formatSpeedKmh(s.avgElapsedKmh)}
          hint="(dựa trên GPS đo được)"
          testId="metric-avg"
        />
      </section>

      <div className="space-y-2">
        {s.status === 'PAUSED' && (
          <Notice tone="info" testId="paused-notice">
            {COPY.paused}
          </Notice>
        )}
        {s.status === 'STARTING' && (
          <Notice tone="info" testId="starting-notice">
            Đang chờ vị trí GPS đủ chính xác (≤ {config.maxAccuracyM} m) để lấy điểm xuất phát.
          </Notice>
        )}
        {s.startWaitExceeded && (
          // Informational only: never ask for action while the user may be driving (docs/00 §0.5).
          <Notice tone="warn" testId="start-timeout">
            {COPY.startTimeout}
          </Notice>
        )}
        {clockTrouble && (
          <Notice tone="warn" testId="clock-notice">
            {COPY.clockSkew}
          </Notice>
        )}
        {hiddenNotice !== null && (
          <Notice
            tone="warn"
            testId="hidden-gap-notice"
            title={COPY.hiddenGap}
            action={
              <Button
                variant="ghost"
                onClick={() => {
                  dismissHiddenNotice(hiddenNotice.to);
                }}
              >
                Đã hiểu
              </Button>
            }
          >
            Khoảng không đo gần nhất: {formatDuration(hiddenNotice.to - hiddenNotice.from)}.
          </Notice>
        )}
        {lostSignal && (
          <Notice tone="warn" testId="signal-lost">
            {COPY.signalLost} {gpsError ?? ''}
          </Notice>
        )}
        {s.status === 'INTERRUPTED' && s.interruptReason === 'GPS_FATAL' && (
          <Notice tone="error" testId="interrupted-notice" title="Việc ghi GPS đã bị gián đoạn.">
            {gpsError ?? COPY.gpsUnavailable} Bạn có thể thử ghi tiếp (tạo đoạn mới) hoặc kết thúc
            chuyến với dữ liệu chưa đầy đủ.
          </Notice>
        )}
        {s.status === 'INTERRUPTED' && s.interruptReason === 'FINALIZE_FAILED' && (
          <Notice tone="error" testId="finalize-failed">
            Chưa lưu được hành trình. Dữ liệu đã ghi vẫn được giữ lại; hãy thử lưu lại.
          </Notice>
        )}
        {s.storageError && (
          <Notice tone="error" testId="storage-error">
            {COPY.storageError}
          </Notice>
        )}
        {s.internalError && <Notice tone="error">{COPY.internalError}</Notice>}
        {!online && <Notice tone="info">{COPY.offline}</Notice>}
      </div>

      <SampleQuality s={s} />

      <div className="grid gap-2 sm:grid-cols-2">
        <WakeLockToggle
          state={s.wakeLock}
          onChange={(wanted) => {
            void tracker.setKeepScreenOn(wanted);
          }}
        />
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm font-semibold ring-1 ring-slate-200">
          Hiện vòng sai số GPS
          <input
            type="checkbox"
            className="h-5 w-5 accent-teal-700"
            checked={showAccuracyCircle}
            onChange={(e) => {
              setShowAccuracyCircle(e.currentTarget.checked);
            }}
          />
        </label>
      </div>

      <PlatformLimitNotice detailed />

      <div className="flex flex-col gap-2 pb-4 sm:flex-row sm:justify-end">
        {s.status === 'STARTING' && (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setConfirmCancel(true);
            }}
          >
            Hủy
          </Button>
        )}
        {s.status === 'RECORDING' && (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              void tracker.pause();
            }}
          >
            Tạm dừng
          </Button>
        )}
        {s.status === 'PAUSED' && (
          <Button
            size="lg"
            onClick={() => {
              void tracker.resume();
            }}
          >
            Tiếp tục
          </Button>
        )}
        {(s.status === 'RECORDING' || s.status === 'PAUSED') && (
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              setConfirmEnd(true);
            }}
          >
            Kết thúc
          </Button>
        )}
        {s.status === 'INTERRUPTED' && s.interruptReason === 'GPS_FATAL' && (
          <>
            <Button
              size="lg"
              onClick={() => {
                void tracker.continueAfterInterruption();
              }}
            >
              Thử ghi tiếp
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={() => {
                setConfirmEnd(true);
              }}
            >
              Kết thúc (chưa đầy đủ)
            </Button>
          </>
        )}
        {s.status === 'INTERRUPTED' && s.interruptReason === 'FINALIZE_FAILED' && (
          <Button size="lg" onClick={() => void finish()}>
            Thử lưu lại
          </Button>
        )}
        {s.status === 'FINALIZING' && (
          <Button size="lg" disabled>
            Đang lưu…
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title="Kết thúc hành trình?"
        description="Hành trình sẽ được lưu với dữ liệu GPS đã đo được. Các khoảng không đo được sẽ được đánh dấu."
        confirmLabel="Kết thúc"
        danger
        onConfirm={() => void finish()}
        onCancel={() => {
          setConfirmEnd(false);
        }}
      />
      <ConfirmDialog
        open={confirmCancel && s.status === 'STARTING'}
        title="Hủy hành trình chưa bắt đầu?"
        description="Chưa có vị trí GPS đủ chính xác nên hành trình chưa được ghi. Hủy sẽ xóa các mẫu thô đã nhận trong lúc chờ."
        confirmLabel="Hủy hành trình"
        cancelLabel="Quay lại"
        danger
        onConfirm={() => {
          setConfirmCancel(false);
          void tracker.cancelStart().then(() => navigate('/'));
        }}
        onCancel={() => {
          setConfirmCancel(false);
        }}
      />
    </div>
  );
}
