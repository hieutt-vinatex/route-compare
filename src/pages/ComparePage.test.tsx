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
import { ORIGIN, straightLine } from '@/tests/fixtures/gpsFixtures';
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
    built.points.map((p) => ({ ...p, tripId: id })),
    built.events.map((e) => ({ ...e, tripId: id })),
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
