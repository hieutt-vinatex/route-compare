import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { straightLine } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples } from '@/tests/fixtures/persistedTrip';
import { createTestServices, type TestServices } from '@/tests/renderApp';
import { useTripDetail } from './useTrips';

let services: TestServices;
beforeEach(() => {
  services = createTestServices();
});

function Probe({ id }: { readonly id: string }) {
  const detail = useTripDetail(id);
  return (
    <p data-testid="probe">
      {detail.status === 'ready'
        ? `${detail.data.trip.name}:${detail.data.points.length}`
        : detail.status}
    </p>
  );
}

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('useTripDetail (NFR-09, M2 minor M16)', () => {
  it('does not re-read every point of an active trip on each new sample — only on a checkpoint', async () => {
    const { trip, points } = persistedTrip(samples(straightLine({ count: 3 })), 'WALK', 'a1');
    await services.repository.create({ ...trip, status: 'RECORDING' });
    for (const p of points.slice(0, 2)) await services.repository.appendRawPoint(p);
    render(
      <ServicesProvider services={services}>
        <Probe id="a1" />
      </ServicesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent('x:2');
    });

    const listPoints = vi.spyOn(services.repository, 'listPoints');
    const third = points[2];
    if (third === undefined) throw new Error('fixture');
    await services.repository.appendRawPoint(third);
    await pause(150);
    expect(listPoints).not.toHaveBeenCalled();

    await services.repository.updateTrip({ ...trip, status: 'RECORDING', updatedAt: 99 });
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent('x:3');
    });
    expect(listPoints).toHaveBeenCalledTimes(1);
  });

  it('follows a rename of the trip row', async () => {
    const { trip } = persistedTrip([], 'WALK', 'a2');
    await services.repository.create({ ...trip, status: 'COMPLETED' });
    render(
      <ServicesProvider services={services}>
        <Probe id="a2" />
      </ServicesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent('x:0');
    });
    await services.repository.updateTrip({ ...trip, status: 'COMPLETED', name: 'y' });
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toHaveTextContent('y:0');
    });
  });
});
