import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackMapProps } from '@/components/map/trackMapTypes';
import type { Trip } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { T0 } from '@/tests/fixtures/gpsFixtures';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

vi.mock('@/components/map/TrackMap', () => ({
  default: (props: TrackMapProps) => <div data-testid="map" aria-label={props.ariaLabel} />,
}));

let services: TestServices;
beforeEach(() => {
  services = createTestServices();
});

async function seed(id: string, name: string, patch: Partial<Trip> = {}): Promise<void> {
  await services.repository.create({
    ...createTrip({ id, name, transportMode: 'MOTORBIKE', startedAt: T0 }),
    status: 'COMPLETED',
    endedAt: T0 + 754_000,
    elapsedMs: 754_000,
    distanceMeasuredM: 4_250,
    coveragePct: 96,
    qualityLabel: 'GOOD',
    metricsVersion: 1,
    ...patch,
  });
}

const rows = () => within(screen.getByTestId('trip-list')).getAllByRole('listitem');

describe('History search and filters (FR-09, RT-301)', () => {
  it('search narrows the list and is kept in the URL', async () => {
    await seed('a', 'Hà Nội đi làm');
    await seed('b', 'Chợ cuối tuần', { startedAt: T0 + 1_000 });
    const { router } = renderApp('/history', services);
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm theo tên' }), 'ha noi');
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(rows()[0]).toHaveTextContent('Hà Nội đi làm');
    expect(router.state.location.search).toBe('?q=ha+noi');
  });

  it('reads the filters from the URL', async () => {
    await seed('a', 'Đi bộ buổi sáng', { transportMode: 'WALK' });
    await seed('b', 'Xe máy đi làm');
    renderApp('/history?mode=WALK', services);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(screen.getByLabelText('Phương tiện')).toHaveValue('WALK');
  });

  it('shows “no match” with a way to clear the filters', async () => {
    await seed('a', 'Hà Nội đi làm');
    renderApp('/history?q=zzz', services);
    expect(await screen.findByText('Không có hành trình khớp bộ lọc.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }));
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
  });

  it('a row shows date, mode, duration, measured distance, coverage and quality as text', async () => {
    await seed('a', 'Hà Nội đi làm');
    renderApp('/history', services);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const row = rows()[0];
    expect(row).toHaveTextContent('Xe máy');
    expect(row).toHaveTextContent('12:34');
    expect(row).toHaveTextContent('4,25 km');
    expect(row).toHaveTextContent('độ phủ 96 %');
    expect(row).toHaveTextContent('GPS: Tốt');
  });

  it('an unfinished trip shows “Chưa kết thúc” and no measured values', async () => {
    await seed('a', 'Đang dở', { status: 'RECORDING', distanceMeasuredM: 999 });
    renderApp('/history', services);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const row = rows()[0];
    expect(row).toHaveTextContent('Chưa kết thúc');
    expect(row).not.toHaveTextContent('999');
    expect(row).not.toHaveTextContent('GPS:');
  });

  it('marks an incomplete trip as such', async () => {
    await seed('a', 'Có khoảng trống', {
      isIncomplete: true,
      qualityLabel: 'LOW',
      coveragePct: 55,
    });
    renderApp('/history', services);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(rows()[0]).toHaveTextContent('Chưa đầy đủ');
    expect(rows()[0]).toHaveTextContent('GPS: Thấp');
  });
});

describe('History with an unfinished trip (review focus 1)', () => {
  it('keeps the recovery notice visible when the filters hide the unfinished row', async () => {
    await seed('a', 'Đang dở', { status: 'RECORDING' });
    await seed('b', 'Đã xong', { startedAt: T0 + 1_000 });
    renderApp('/history?status=COMPLETE', services);
    expect(await screen.findByTestId('recovery-notice')).toBeInTheDocument();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(rows()[0]).toHaveTextContent('Đã xong');
  });
});
