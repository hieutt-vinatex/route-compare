/**
 * Compare page end to end (RT-401, RT-402, RT-403) over the real repository and analytics.
 * The assertions that matter are the refusals: no grouping without measured endpoints, a warning
 * on low coverage, and no median/P90 until there are enough trips.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { destinationPoint } from '@/domain/geo/haversine';
import { DEFAULT_GPS_CONFIG } from '@/domain/models/gpsConfig';
import type { Trip } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { ORIGIN, straightLine, T0 } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples } from '@/tests/fixtures/persistedTrip';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

let services: TestServices;

beforeEach(() => {
  services = createTestServices();
});

const END = destinationPoint(ORIGIN, 90, 5 * 59);

/** A finished trip over the same A→B pair, stored with its points and events. */
async function store(
  id: string,
  options: { startedAt: number; speedMps?: number; count?: number } & Partial<Trip>,
): Promise<void> {
  const { startedAt, speedMps = 5, count = 60, ...overrides } = options;
  const steps = samples(straightLine({ count, speedMps, startT: 0 }));
  const built = persistedTrip(steps, 'MOTORBIKE', id);
  const trip: Trip = {
    ...createTrip({ id, name: id, transportMode: 'MOTORBIKE', startedAt }),
    status: 'COMPLETED',
    endedAt: startedAt + count * 1000,
    elapsedMs: count * 1000,
    startLat: ORIGIN.lat,
    startLng: ORIGIN.lng,
    endLat: END.lat,
    endLng: END.lng,
    ...overrides,
  };
  await services.repository.importTrip(
    trip,
    built.points.map((p) => ({
      ...p,
      tripId: id,
      sourceTimestamp: p.sourceTimestamp + startedAt - T0,
      recordedAt: p.recordedAt + startedAt - T0,
    })),
    built.events.map((e) => ({ ...e, tripId: id, timestamp: e.timestamp + startedAt - T0 })),
  );
}

describe('Compare page', () => {
  it('groups trips on the same A→B and compares the selected ones', async () => {
    await store('Chuyen A', { startedAt: 1_000_000 });
    await store('Chuyen B', { startedAt: 2_000_000 });
    renderApp('/compare', services);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen A/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen B/ }));

    const table = await screen.findByTestId('compare-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 trips
    expect(within(table).getByText('nhanh nhất')).toBeInTheDocument();
  });

  it('never shows rows for a selection that is no longer ticked (slow storage)', async () => {
    // CI reproduced this: Dexie's useLiveQuery keeps serving the PREVIOUS result while it re-runs,
    // so ticking the 2nd trip briefly rendered a one-row "comparison" of the 1st.
    await store('Chuyen A', { startedAt: 1_000_000 });
    await store('Chuyen B', { startedAt: 2_000_000 });
    const listPoints = services.repository.listPoints.bind(services.repository);
    services.repository.listPoints = async (id: string) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return listPoints(id);
    };
    renderApp('/compare', services);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen A/ }));
    // Let the one-trip analysis finish first — that finished result is the stale value the hook
    // would otherwise keep serving while the two-trip analysis runs.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen B/ }));

    const table = await screen.findByTestId('compare-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('never claims same endpoints mean the same road', async () => {
    await store('Chuyen A', { startedAt: 1_000_000 });
    await store('Chuyen B', { startedAt: 2_000_000 });
    renderApp('/compare', services);
    expect(
      await screen.findByText(/có nghĩa là cùng một con đường/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/không phải giữa hai tuyến đường/, { exact: false }),
    ).toBeInTheDocument();
  });

  it('withholds median and P90 until there are enough trips, then reports them', async () => {
    await store('Chuyen A', { startedAt: 1_000_000 });
    await store('Chuyen B', { startedAt: 2_000_000 });
    renderApp('/compare', services);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen A/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen B/ }));
    expect(await screen.findByTestId('compare-distribution')).toHaveTextContent(/chưa đủ/);
  });

  it('warns when a selected trip has low GPS coverage', async () => {
    await store('Chuyen A', { startedAt: 1_000_000 });
    // Same track, but the trip ran far longer than the GPS covered → low coverage.
    await store('Chuyen B', { startedAt: 2_000_000, endedAt: 2_000_000 + 600_000 });
    renderApp('/compare', services);

    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen A/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Chuyen B/ }));
    expect(await screen.findByTestId('compare-low-coverage')).toBeInTheDocument();
  });

  it('offers nothing to compare when endpoints were never measured', async () => {
    await store('Chuyen A', { startedAt: 1_000_000, endLat: null, endLng: null });
    await store('Chuyen B', { startedAt: 2_000_000, endLat: null, endLng: null });
    renderApp('/compare', services);
    expect(await screen.findByText('Chưa có nhóm hành trình nào để so sánh')).toBeInTheDocument();
  });

  it('keeps the reverse direction in a separate group', async () => {
    await store('Chuyen A', { startedAt: 1_000_000 });
    await store('Chuyen nguoc', {
      startedAt: 2_000_000,
      startLat: END.lat,
      startLng: END.lng,
      endLat: ORIGIN.lat,
      endLng: ORIGIN.lng,
    });
    renderApp('/compare', services);
    // Two groups → a group selector appears, and only one trip is listed per group.
    expect(await screen.findByText('Nhóm tuyến')).toBeInTheDocument();
    expect(DEFAULT_GPS_CONFIG.routeGroupRadiusM).toBe(150);
  });
});

describe('complete comparison report', () => {
  it('includes every duration/speed, departure and measured-distance delta with missing speeds as dashes', async () => {
    await store('A', { startedAt: new Date(2026, 10, 1, 8).getTime(), count: 2 });
    await store('B', { startedAt: new Date(2026, 10, 2, 10).getTime(), count: 2 });
    renderApp('/compare', services);
    await userEvent.click(await screen.findByRole('checkbox', { name: /^A/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /^B/ }));
    const table = await screen.findByTestId('compare-table');
    for (const name of [
      'Khởi hành',
      'Di chuyển',
      'Đứng yên',
      'Tạm dừng',
      'Không rõ',
      'TB toàn chuyến',
      'TB di chuyển',
      'Cao nhất đã lọc',
      'Thấp nhất đã lọc',
      'Chênh lệch GPS đo được',
    ]) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
    expect(await screen.findByTestId('compare-different-dates')).toBeInTheDocument();
    expect(await screen.findByTestId('compare-different-windows')).toBeInTheDocument();
  });

  it('uses all group trips for per-variant statistics while limiting the overlay to four', async () => {
    for (let i = 0; i < 5; i++) {
      await store(`A${String(i)}`, {
        startedAt: new Date(2026, 10, 1 + i, 8).getTime(),
        routeVariantLabel: 'Đường X',
      });
    }
    renderApp('/compare', services);
    const stats = await screen.findByTestId('compare-distribution');
    expect(stats).toHaveTextContent('5 hành trình · 5 ngày');
    expect(stats).toHaveTextContent('Đường X');
    expect(stats).toHaveTextContent('Độ lệch chuẩn');
    const boxes = await screen.findAllByRole('checkbox');
    for (const box of boxes.slice(0, 4)) await userEvent.click(box);
    expect(boxes[4]).toBeDisabled();
    expect(within(await screen.findByTestId('compare-table')).getAllByRole('row')).toHaveLength(5);
    expect(stats).toHaveTextContent('5 hành trình · 5 ngày');
  });
});
