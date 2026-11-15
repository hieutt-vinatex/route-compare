/**
 * Backup / restore through the real UI and repository (RT-404, RT-405).
 * A restore must never overwrite or damage what is already stored.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toBackupJson } from '@/domain/export/serialize';
import type { Trip } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { ORIGIN, straightLine } from '@/tests/fixtures/gpsFixtures';
import { persistedTrip, samples } from '@/tests/fixtures/persistedTrip';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

let services: TestServices;

beforeEach(() => {
  services = createTestServices();
  // jsdom has no download pipeline; the adapter's DOM calls are exercised, the file is not saved.
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

function bundleOf(id: string): { trip: Trip; points: unknown[]; events: unknown[] } {
  const built = persistedTrip(samples(straightLine({ count: 20, speedMps: 5 })), 'MOTORBIKE', id);
  return {
    trip: {
      ...createTrip({ id, name: id, transportMode: 'MOTORBIKE', startedAt: 1_000_000 }),
      status: 'COMPLETED',
      endedAt: 1_020_000,
      startLat: ORIGIN.lat,
      startLng: ORIGIN.lng,
      endLat: ORIGIN.lat,
      endLng: ORIGIN.lng,
    },
    points: built.points.map((p) => ({ ...p, tripId: id })),
    events: built.events.map((e) => ({ ...e, tripId: id })),
  };
}

async function upload(accept: string, file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`input[type="file"][accept*="${accept}"]`);
  if (input === null) throw new Error(`no ${accept} input`);
  await userEvent.upload(input, file);
}

describe('backup and restore', () => {
  it('restores trips from a backup file', async () => {
    const json = toBackupJson([bundleOf('Chuyen cu') as never], 1_000_000);
    renderApp('/history', services);
    await screen.findByText('Sao lưu và khôi phục');

    await upload('json', new File([json], 'backup.json', { type: 'application/json' }));

    expect(await screen.findByTestId('restore-done')).toHaveTextContent('Đã khôi phục 1');
    const trips = await services.repository.listTrips();
    expect(trips.map((t) => t.id)).toEqual(['Chuyen cu']);
    expect(await services.repository.listPoints('Chuyen cu')).not.toHaveLength(0);
  });

  it('never overwrites a trip that is already stored', async () => {
    const bundle = bundleOf('Chuyen cu');
    await services.repository.importTrip(
      { ...bundle.trip, name: 'Tên tôi đã đổi' },
      bundle.points as never,
      bundle.events as never,
    );
    renderApp('/history', services);
    await screen.findByText('Sao lưu và khôi phục');

    await upload(
      'json',
      new File([toBackupJson([bundle as never], 1_000_000)], 'backup.json', {
        type: 'application/json',
      }),
    );

    expect(await screen.findByTestId('restore-done')).toHaveTextContent('bỏ qua 1');
    const trips = await services.repository.listTrips();
    expect(trips[0]?.name).toBe('Tên tôi đã đổi');
  });

  it('reports a corrupt file and stores nothing', async () => {
    renderApp('/history', services);
    await screen.findByText('Sao lưu và khôi phục');

    await upload('json', new File(['{"app":"other"}'], 'x.json', { type: 'application/json' }));

    expect(await screen.findByTestId('backup-error')).toHaveTextContent(/không phải bản sao lưu/i);
    expect(await services.repository.listTrips()).toHaveLength(0);
  });

  it('exports every stored trip', async () => {
    const bundle = bundleOf('Chuyen cu');
    await services.repository.importTrip(
      bundle.trip,
      bundle.points as never,
      bundle.events as never,
    );
    renderApp('/history', services);

    await userEvent.click(await screen.findByRole('button', { name: 'Tải bản sao lưu' }));
    expect(await screen.findByTestId('backup-done')).toHaveTextContent('1 hành trình');
  });
});
