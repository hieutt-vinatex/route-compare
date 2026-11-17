import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { createTrip } from '@/domain/trip/tripFactory';
import { createTestServices } from '@/tests/renderApp';
import { RouteVariantEditor } from './RouteVariantEditor';

const trip = {
  ...createTrip({ id: 'variant-trip', name: 'Đi làm', transportMode: 'WALK', startedAt: 1_000 }),
  status: 'COMPLETED' as const,
};

describe('RouteVariantEditor (FR-19)', () => {
  it('saves and clears a label through the repository and reports success', async () => {
    const services = createTestServices();
    await services.repository.create(trip);
    render(
      <ServicesProvider services={services}>
        <RouteVariantEditor trip={trip} />
      </ServicesProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Phương án đường' });
    expect(input).toHaveValue('');
    await userEvent.type(input, '  Qua đường A  ');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu phương án đường' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu phương án đường.');
    expect((await services.repository.getTrip(trip.id))?.routeVariantLabel).toBe('Qua đường A');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu phương án đường' }));
    await waitFor(async () => {
      expect((await services.repository.getTrip(trip.id))?.routeVariantLabel).toBeNull();
    });
  });

  it('reports a storage failure and retains the draft for retry', async () => {
    const services = createTestServices();
    vi.spyOn(services.repository, 'setRouteVariant').mockRejectedValue(
      new Error('Storage failure'),
    );
    render(
      <ServicesProvider services={services}>
        <RouteVariantEditor trip={trip} />
      </ServicesProvider>,
    );
    await userEvent.type(screen.getByRole('textbox'), 'Đường A');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu phương án đường' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không lưu được phương án đường. Hãy thử lại.',
    );
    expect(screen.getByRole('textbox')).toHaveValue('Đường A');
  });

  it('shows an external metadata update instead of a stale draft', async () => {
    const services = createTestServices();
    const view = (label: string | null) => (
      <ServicesProvider services={services}>
        <RouteVariantEditor trip={{ ...trip, routeVariantLabel: label }} />
      </ServicesProvider>
    );
    const { rerender } = render(view('Đường A'));
    await userEvent.type(screen.getByRole('textbox'), ' draft');
    rerender(view('Đường B'));
    expect(screen.getByRole('textbox')).toHaveValue('Đường B');
  });

  it('offers no editing controls for an unfinished trip', () => {
    render(
      <ServicesProvider services={createTestServices()}>
        <RouteVariantEditor trip={{ ...trip, status: 'RECORDING' }} />
      </ServicesProvider>,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
