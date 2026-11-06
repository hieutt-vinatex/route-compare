import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/copy';
import type { TrackMapProps } from '@/components/map/trackMapTypes';
import type { Trip } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { ORIGIN, straightLine, T0, toSample, type SampleSpec } from '@/tests/fixtures/gpsFixtures';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

// Leaflet needs a real layout engine; it is covered by Playwright. Here we only check props.
vi.mock('@/components/map/TrackMap', () => ({
  default: (props: TrackMapProps) => (
    <div
      data-testid="map"
      aria-label={props.ariaLabel}
      data-segments={props.segments.length}
      data-has-current={props.current ? 'yes' : 'no'}
    />
  ),
}));

let services: TestServices;

beforeEach(() => {
  services = createTestServices();
});

async function emit(spec: SampleSpec): Promise<void> {
  services.manualClock.set(T0 + spec.t + 200);
  services.geo.emit(toSample(spec));
  await act(async () => {
    await services.tracker.settle();
  });
}

async function publish(): Promise<void> {
  await act(async () => {
    await services.tracker.settle();
  });
}

describe('Home (FR-01, FR-02, BR-02)', () => {
  it('does not prompt for location until the user asks, and keeps Start disabled', async () => {
    services.geo.permission = 'prompt';
    const spy = vi.spyOn(services.geo, 'getCurrentPosition');
    renderApp('/', services);
    expect(await screen.findByText('GPS: Chưa cấp quyền')).toBeInTheDocument();
    expect(screen.getByTestId('platform-limit-notice')).toHaveTextContent(COPY.platformHint);
    expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();

    services.geo.currentPosition = toSample({
      t: 0,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      accuracyM: 6,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Xác định vị trí của tôi' }));
    expect(await screen.findByText('GPS: Sẵn sàng')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeEnabled();
  });

  it('auto-locates when permission is already granted', async () => {
    services.geo.currentPosition = toSample({
      t: 0,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      accuracyM: 6,
    });
    renderApp('/', services);
    expect(await screen.findByText('GPS: Sẵn sàng')).toBeInTheDocument();
    expect(screen.getByTestId('home-accuracy')).toHaveTextContent('±6 m');
  });

  it('shows the permission-denied guidance (NFR-10)', async () => {
    services.geo.permission = 'denied';
    renderApp('/', services);
    expect(await screen.findByTestId('gps-denied')).toHaveTextContent(COPY.permissionDenied);
    expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
  });

  it('blocks Start while another tab of this browser is recording (FR-13)', async () => {
    services.geo.currentPosition = toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng });
    services.mockLock.heldByOtherTab = true;
    renderApp('/', services);
    expect(await screen.findByTestId('recorder-busy')).toHaveTextContent('tab khác');
    await screen.findByText('GPS: Sẵn sàng');
    expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
    act(() => {
      services.mockLock.setHeldByOtherTab(false);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeEnabled();
    });
  });

  it('explains when location is unavailable / timed out', async () => {
    services.geo.currentPosition = { code: 'POSITION_UNAVAILABLE', message: 'x' };
    renderApp('/', services);
    expect(await screen.findByText(COPY.gpsUnavailable)).toBeInTheDocument();
  });

  it('requires HTTPS (insecure context)', async () => {
    services = createTestServices({ secure: false });
    renderApp('/', services);
    expect(await screen.findByTestId('gps-insecure')).toHaveTextContent(COPY.insecureContext);
    expect(screen.getByText('GPS: Cần HTTPS')).toBeInTheDocument();
  });

  it('reports unsupported browsers', async () => {
    services.geo.supported = false;
    renderApp('/', services);
    expect(await screen.findByText('GPS: Không hỗ trợ')).toBeInTheDocument();
  });

  it('allows Start with a low-accuracy fix but explains the wait', async () => {
    services.geo.currentPosition = toSample({
      t: 0,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      accuracyM: 65,
    });
    renderApp('/', services);
    expect(await screen.findByText('GPS: Độ chính xác thấp')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeEnabled();
    expect(screen.getByText(/sẽ chờ GPS đạt ±30 m/)).toBeInTheDocument();
  });
});

describe('Tracking flow (AC-01, AC-03, AC-04)', () => {
  async function startFromHome(): Promise<void> {
    services.geo.currentPosition = toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng });
    renderApp('/', services);
    await screen.findByText('GPS: Sẵn sàng');
    await userEvent.selectOptions(screen.getByLabelText('Phương tiện'), 'WALK');
    await userEvent.click(screen.getByRole('button', { name: 'Bắt đầu ghi hành trình' }));
    // start() writes the trip row (IndexedDB) before registering the watch; a real device
    // cannot deliver fixes before that either.
    await waitFor(() => {
      expect(services.geo.isWatching()).toBe(true);
    });
    await publish();
    // Every trip's first callback only calibrates the fix/app clock offset.
    await emit({ t: 500, lat: ORIGIN.lat, lng: ORIGIN.lng });
  }

  it('Start → STARTING → RECORDING → End with confirm → trip detail', async () => {
    await startFromHome();
    expect(await screen.findByText('Đang chờ GPS để bắt đầu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
    expect(screen.getByTestId('metric-speed')).toHaveTextContent('—');

    for (const spec of straightLine({ count: 11, startT: 1_000, speedMps: 5 })) await emit(spec);
    expect(screen.getByText('Đang ghi')).toBeInTheDocument();
    expect(screen.getByTestId('metric-distance')).toHaveTextContent('50 m');
    expect(screen.getByTestId('metric-speed')).toHaveTextContent('18,0 km/h');
    expect(screen.getByTestId('segment-count')).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('button', { name: 'Kết thúc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kết thúc hành trình?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kết thúc' }));

    expect(await screen.findByTestId('detail-distance')).toHaveTextContent('50 m');
    expect(screen.getByTestId('detail-segments')).toHaveTextContent('1');
    // docs/05 analytics are shown, not “chưa tính”.
    expect(screen.queryByText(/chưa tính/)).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-moving')).toHaveTextContent('00:10');
    expect(screen.getByTestId('detail-paused')).toHaveTextContent('00:00');
    expect(screen.getByTestId('detail-coverage')).toHaveTextContent('%');
    expect(screen.getByTestId('detail-quality')).toHaveTextContent(/GOOD|FAIR|LOW|Tốt|Khá|Thấp/);
    expect(screen.getByText('Đi bộ', { exact: false })).toBeInTheDocument();
    const events = within(screen.getByTestId('trip-events')).getAllByRole('listitem');
    expect(events.map((li) => li.dataset.eventType)).toEqual(['START', 'END']);
  });

  it('Tạm dừng / Tiếp tục switch the recording state', async () => {
    await startFromHome();
    for (const spec of straightLine({ count: 3, startT: 1_000 })) await emit(spec);
    await userEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    await publish();
    expect(await screen.findByTestId('paused-notice')).toBeInTheDocument();
    expect(screen.getByTestId('tracking-status')).toHaveTextContent('Tạm dừng');
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await publish();
    expect(services.tracker.getSnapshot().status).toBe('RECORDING');
    expect(screen.queryByTestId('paused-notice')).not.toBeInTheDocument();
  });

  it('cancelling the confirm dialog keeps recording', async () => {
    await startFromHome();
    await emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    await userEvent.click(screen.getByRole('button', { name: 'Kết thúc' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Quay lại' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(services.tracker.getSnapshot().status).toBe('RECORDING');
  });

  it('marks a hidden interval as unmeasured and shows 2 segments', async () => {
    await startFromHome();
    for (const spec of straightLine({ count: 3, startT: 1_000 })) await emit(spec);
    services.manualClock.set(T0 + 4_000);
    act(() => {
      services.mockVisibility.setVisible(false);
    });
    services.manualClock.set(T0 + 40_000);
    act(() => {
      services.mockVisibility.setVisible(true);
    });
    await publish();
    for (const spec of straightLine({
      count: 3,
      startT: 40_500,
      from: { lat: ORIGIN.lat + 0.003, lng: ORIGIN.lng },
    })) {
      await emit(spec);
    }
    const notice = await screen.findByTestId('hidden-gap-notice');
    expect(notice).toHaveTextContent(COPY.hiddenGap);
    expect(notice).toHaveTextContent('00:36');
    expect(screen.getByTestId('segment-count')).toHaveTextContent('2');
    expect(screen.getByTestId('map')).toHaveAttribute('data-segments', '2');
    expect(screen.getByTestId('metric-distance')).toHaveTextContent('20 m');

    await userEvent.click(within(notice).getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.queryByTestId('hidden-gap-notice')).not.toBeInTheDocument();
  });

  it('shows the interruption UX when permission is revoked mid-trip', async () => {
    await startFromHome();
    await emit({ t: 1_000, lat: ORIGIN.lat, lng: ORIGIN.lng });
    services.geo.emitError({ code: 'PERMISSION_DENIED', message: 'revoked' });
    await publish();
    expect(await screen.findByTestId('interrupted-notice')).toHaveTextContent(
      COPY.permissionDenied,
    );
    expect(screen.getByRole('button', { name: 'Thử ghi tiếp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kết thúc (chưa đầy đủ)' })).toBeInTheDocument();
  });

  it('a trip that is still recording is not shown as a finished, gap-free trip (review I5)', async () => {
    await startFromHome();
    for (const spec of straightLine({ count: 3, startT: 1_000 })) await emit(spec);
    const tripId = services.tracker.getSnapshot().tripId ?? '';

    cleanup(); // same services (same live trip), fresh UI on the History page
    const { router } = renderApp('/history', services);
    const row = await screen.findByRole('link', { name: /Hành trình/ });
    expect(row).toHaveTextContent('đang ghi / chưa hoàn tất');
    expect(row).not.toHaveTextContent('0 m đo được');

    await act(() => router.navigate(`/trips/${tripId}`));
    expect(await screen.findByTestId('trip-in-progress')).toBeInTheDocument();
    expect(screen.queryByText('Không phát hiện gián đoạn')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-distance')).toHaveTextContent('—');
  });

  it('explains when GPS timestamps disagree with the device clock (review I2)', async () => {
    await startFromHome();
    for (const spec of straightLine({ count: 3, startT: 1_000 })) await emit(spec);
    // Fixes whose delay keeps changing (30 s, 45 s, 60 s…): no stable clock offset, so they
    // are rejected and the user is told why. (A constant offset would simply be accepted.)
    for (let i = 0; i < 8; i += 1) {
      const recordedAt = T0 + 60_000 + i * 1_000;
      services.manualClock.set(recordedAt);
      services.geo.emit({
        ...toSample({ t: 0, lat: ORIGIN.lat, lng: ORIGIN.lng }),
        sourceTimestamp: recordedAt - (30_000 + i * 15_000),
        recordedAt,
      });
    }
    await publish();
    expect(await screen.findByTestId('clock-notice')).toBeInTheDocument();
  });

  it('cancel while STARTING asks for confirmation first', async () => {
    await startFromHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hủy hành trình chưa bắt đầu?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quay lại' }));
    expect(services.tracker.getSnapshot().status).toBe('STARTING');
  });

  it('cancel while STARTING returns home without creating a trip', async () => {
    await startFromHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Hủy' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hủy hành trình' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Ghi hành trình' })).toBeInTheDocument();
    });
    expect(await services.repository.listTrips()).toEqual([]);
  });
});

describe('Recovery after reload (FR-12, UC-08)', () => {
  async function leftover(patch: Partial<Trip>) {
    await services.repository.create({
      ...createTrip({ id: 'left', name: 'Chuyến dang dở', transportMode: 'WALK', startedAt: T0 }),
      status: 'RECORDING',
      ...patch,
    });
  }

  it('offers to resume (new segment) or end an unfinished trip', async () => {
    await leftover({ startLat: ORIGIN.lat, startLng: ORIGIN.lng });
    renderApp('/', services);
    const notice = await screen.findByTestId('recovery-notice');
    expect(notice).toHaveTextContent('Chuyến dang dở');
    expect(
      within(notice).getByRole('button', { name: 'Kết thúc (chưa đầy đủ)' }),
    ).toBeInTheDocument();
    await userEvent.click(within(notice).getByRole('button', { name: 'Tiếp tục ghi (đoạn mới)' }));
    await waitFor(() => {
      expect(services.tracker.getSnapshot().tripId).toBe('left');
    });
    expect(await screen.findByRole('heading', { name: 'Chuyến dang dở' })).toBeInTheDocument();
  });

  it('a trip without any start fix can only be cancelled', async () => {
    await leftover({});
    renderApp('/history', services);
    const notice = await screen.findByTestId('recovery-notice');
    expect(within(notice).queryByRole('button', { name: 'Kết thúc (chưa đầy đủ)' })).toBeNull();
    await userEvent.click(within(notice).getByRole('button', { name: 'Hủy hành trình' }));
    await waitFor(() => {
      expect(screen.queryByTestId('recovery-notice')).not.toBeInTheDocument();
    });
    expect(await services.repository.listTrips()).toEqual([]);
  });

  it('is not offered while another tab is recording', async () => {
    await leftover({ startLat: ORIGIN.lat, startLng: ORIGIN.lng });
    services.mockLock.heldByOtherTab = true;
    renderApp('/', services);
    await screen.findByText(/GPS:/);
    expect(screen.queryByTestId('recovery-notice')).not.toBeInTheDocument();
  });
});

describe('Wake Lock toggle (FR-16, AC-10)', () => {
  it('is replaced by an explanation when unsupported', async () => {
    services.mockWakeLock.supported = false;
    await services.tracker.start({ name: 'T', transportMode: 'CAR' });
    renderApp('/tracking', services);
    expect(await screen.findByTestId('wakelock-unsupported')).toHaveTextContent(
      COPY.wakeLockUnsupported,
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('turns on, and reports a refusal without blocking tracking', async () => {
    services.mockWakeLock.denyRequests = true;
    await services.tracker.start({ name: 'T', transportMode: 'CAR' });
    renderApp('/tracking', services);
    const toggle = await screen.findByRole('switch', { name: 'Giữ màn hình sáng' });
    await userEvent.click(toggle);
    expect(await screen.findByTestId('wakelock-failed')).toHaveTextContent(COPY.wakeLockFailed);
    expect(services.tracker.getSnapshot().status).toBe('STARTING');
  });
});

describe('Routes & layout (RT-002)', () => {
  it('shows an empty tracking page when nothing is recording', async () => {
    renderApp('/tracking', services);
    expect(await screen.findByText('Chưa có hành trình đang ghi')).toBeInTheDocument();
  });

  it('renders history empty state, compare placeholder and 404', async () => {
    const { router } = renderApp('/history', services);
    expect(await screen.findByText(COPY.noTrips)).toBeInTheDocument();
    await act(() => router.navigate('/compare'));
    expect(await screen.findByText('Tính năng so sánh đang được phát triển')).toBeInTheDocument();
    await act(() => router.navigate('/khong-ton-tai'));
    expect(await screen.findByText('Không tìm thấy trang')).toBeInTheDocument();
    await act(() => router.navigate('/trips/unknown'));
    expect(await screen.findByText('Không tìm thấy hành trình')).toBeInTheDocument();
  });

  it('has the bottom navigation Trang chủ | Lịch sử | So sánh', async () => {
    renderApp('/history', services);
    const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính (di động)' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent.trim()),
    ).toEqual(['Trang chủ', 'Lịch sử', 'So sánh']);
  });
});
