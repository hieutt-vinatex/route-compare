import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDistance } from '@/app/format';
import type { TrackMapProps } from '@/components/map/trackMapTypes';
import { analyzeTrip } from '@/domain/analytics/analyzeTrip';
import { destinationPoint } from '@/domain/geo/haversine';
import { DEFAULT_GPS_CONFIG } from '@/domain/models/gpsConfig';
import type { Trip } from '@/domain/models/types';
import { ORIGIN, straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples, type Step } from '@/tests/fixtures/persistedTrip';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

vi.mock('@/components/map/TrackMap', () => ({
  default: (props: TrackMapProps) => (
    <div data-testid="map" aria-label={props.ariaLabel} data-segments={props.segments.length} />
  ),
}));

// Chart.js needs a real canvas (Playwright covers it); here only the chart's presence matters.
vi.mock('react-chartjs-2', () => ({
  Line: (props: { 'aria-label'?: string }) => (
    <canvas data-testid="chart-canvas" aria-label={props['aria-label']} />
  ),
}));

let services: TestServices;
beforeEach(() => {
  services = createTestServices();
});

/** Store a finished trip whose raw data says one thing and whose stored summary another. */
async function seedCompleted(steps: readonly Step[], endT: number, patch: Partial<Trip> = {}) {
  const { trip, points, events } = persistedTrip(steps, 'MOTORBIKE', 'd1');
  await services.repository.create({
    ...trip,
    name: 'Đi làm',
    status: 'COMPLETED',
    endedAt: T0 + endT,
    elapsedMs: endT,
    metricsVersion: 1,
    ...patch,
  });
  for (const p of points) await services.repository.appendRawPoint(p);
  for (const e of events) await services.repository.appendEvent(e);
}

/** Two 30 s stretches at 5 m/s with a 3-minute GPS gap between them. */
function withGap(): Step[] {
  const a = straightLine({ count: 30, speedMps: 5 });
  const b = straightLine({
    count: 30,
    startT: 210_000,
    speedMps: 5,
    from: destinationPoint(ORIGIN, 90, 1_000),
  });
  return [...samples(a), ...samples(b)];
}

describe('Trip Detail from one analysis (FR-10, RT-302, RT-304)', () => {
  it('map, counts and stats come from the replayed raw data, not stored live results (M10)', async () => {
    await seedCompleted(withGap(), 240_000, { distanceMeasuredM: 999_999 });
    renderApp('/trips/d1', services);
    const map = await screen.findByTestId('map');
    await waitFor(() => {
      expect(map).toHaveAttribute('data-segments', '2');
    });
    expect(screen.getByTestId('detail-segments')).toHaveTextContent('2');
    const { trip, points, events } = persistedTrip(withGap(), 'MOTORBIKE', 'd1');
    const replayed = analyzeTrip({
      trip,
      points,
      events,
      endedAt: T0 + 240_000,
      config: DEFAULT_GPS_CONFIG,
    });
    const distance = screen.getByTestId('detail-distance');
    expect(distance).toHaveTextContent(formatDistance(replayed.distanceMeasuredM));
    expect(distance).not.toHaveTextContent('999');
  });

  it('a LOW trip states how many minutes lack GPS (docs/06 §4) and lists the reasons', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    expect(
      await screen.findByText(
        'GPS thiếu dữ liệu trong 3 phút; quãng đường hiển thị chỉ là phần đã đo được.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('detail-quality')).toHaveTextContent('Thấp');
    expect(within(screen.getByTestId('incomplete-reasons')).getAllByRole('listitem').length).toBe(
      1,
    );
    // ~3 minutes between the two stretches (plus start-up), from the analysis.
    expect(screen.getByTestId('detail-gps-gap')).toHaveTextContent(/^03:0\d$/);
  });

  it('plots speed over time with a text summary (RT-303)', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    expect(
      await screen.findByRole('heading', { name: 'Tốc độ theo thời gian' }),
    ).toBeInTheDocument();
    const chart = await screen.findByTestId('chart-canvas');
    expect(chart.getAttribute('aria-label')).toMatch(/không xác định/);
  });

  it('shows units, and “—” for speeds without evidence', async () => {
    await seedCompleted(samples(straightLine({ count: 2, speedMps: 5 })), 2_000);
    renderApp('/trips/d1', services);
    expect(await screen.findByTestId('detail-distance')).toHaveTextContent('m');
    expect(screen.getByTestId('detail-max-speed')).toHaveTextContent('—');
    expect(screen.getByTestId('detail-min-speed')).toHaveTextContent('—');
  });

  it('“Cách tính” explains the docs/05 formulas', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    await userEvent.click(await screen.findByText('Cách tính các số liệu'));
    const notes = screen.getByTestId('formula-notes');
    expect(notes).toHaveTextContent(
      'Tổng thời gian = Di chuyển + Dừng + Không xác định + Tạm dừng',
    );
    expect(notes).toHaveTextContent('TB toàn chuyến = Quãng đường GPS đo được ÷ Tổng thời gian');
    expect(notes).toHaveTextContent(
      'TB khi di chuyển = Quãng đường GPS đo được ÷ Thời gian di chuyển',
    );
    expect(notes).toHaveTextContent(
      'Độ phủ GPS = (Di chuyển + Dừng) ÷ (Tổng thời gian − Tạm dừng)',
    );
    expect(notes).toHaveTextContent('0 km/h chỉ khi đã xác nhận dừng');
  });

  it('a trip ended with a storage error stays “chưa đầy đủ” even if its GPS data is complete', async () => {
    const clean = samples(straightLine({ count: 30, speedMps: 5 }));
    await seedCompleted([...clean, { event: 'STORAGE_ERROR', t: 29_500 }], 30_000, {
      isIncomplete: true,
    });
    renderApp('/trips/d1', services);
    expect(await screen.findByTestId('trip-incomplete')).toBeInTheDocument();
    const reasons = screen.getByTestId('incomplete-reasons');
    expect(
      within(reasons)
        .getAllByRole('listitem')
        .map((li) => li.dataset.reason),
    ).toContain('STORAGE');
  });

  it('a trip still recording keeps the “in progress” view with “—” values', async () => {
    const { trip, points } = persistedTrip(samples(straightLine({ count: 5 })), 'WALK', 'r1');
    await services.repository.create({ ...trip, status: 'RECORDING', distanceMeasuredM: 50 });
    for (const p of points) await services.repository.appendRawPoint(p);
    renderApp('/trips/r1', services);
    expect(await screen.findByTestId('trip-in-progress')).toBeInTheDocument();
    expect(screen.getByTestId('detail-distance')).toHaveTextContent('—');
  });
});

describe('rename and delete (FR-10, FR-14, AC-08)', () => {
  it('renames through a dialog; the heading and stored name follow', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    await userEvent.click(await screen.findByRole('button', { name: 'Đổi tên' }));
    const dialog = screen.getByRole('dialog', { name: 'Đổi tên hành trình' });
    const input = within(dialog).getByLabelText('Tên hành trình');
    expect(input).toHaveValue('Đi làm');
    await userEvent.clear(input);
    await userEvent.type(input, 'Đi làm qua Láng');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Đi làm qua Láng' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await services.repository.getTrip('d1'))?.name).toBe('Đi làm qua Láng');
  });

  it('an empty name cannot be saved', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    await userEvent.click(await screen.findByRole('button', { name: 'Đổi tên' }));
    const dialog = screen.getByRole('dialog', { name: 'Đổi tên hành trình' });
    await userEvent.clear(within(dialog).getByLabelText('Tên hành trình'));
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('delete asks to confirm, removes trip, points and events, and returns to History', async () => {
    await seedCompleted([{ event: 'START', t: 0 }, ...withGap()], 240_000);
    const { router } = renderApp('/trips/d1', services);
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa hành trình' }));
    const dialog = screen.getByRole('dialog', { name: 'Xóa hành trình này?' });
    expect(dialog).toHaveTextContent('Không thể hoàn tác');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/history');
    });
    expect(await services.repository.getTrip('d1')).toBeUndefined();
    expect(await services.repository.listPoints('d1')).toEqual([]);
    expect(await services.repository.listEvents('d1')).toEqual([]);
  });

  it('cancelling the delete keeps everything', async () => {
    await seedCompleted(withGap(), 240_000);
    renderApp('/trips/d1', services);
    await userEvent.click(await screen.findByRole('button', { name: 'Xóa hành trình' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Quay lại' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await services.repository.getTrip('d1')).toBeDefined();
  });

  it('offers no rename or delete for a trip that is still recording (BR-01)', async () => {
    const { trip } = persistedTrip([], 'WALK', 'r1');
    await services.repository.create({ ...trip, status: 'RECORDING' });
    renderApp('/trips/r1', services);
    expect(await screen.findByTestId('trip-in-progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa hành trình' })).toBeNull();
  });
});
