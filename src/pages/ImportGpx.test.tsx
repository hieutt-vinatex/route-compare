/**
 * GPX import end to end through the real UI, repository and analytics (RT-404).
 *
 * This is the path that answers "ghi khi tắt màn hình": a background logger on the phone writes
 * the GPX, RouteTrack reads it. The imported trip must be measurable AND clearly marked as not
 * RouteTrack's own measurement.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

let services: TestServices;

beforeEach(() => {
  services = createTestServices();
});

/** A background logger's file: 30 s between fixes, moving ~36 km/h, one restart. */
function loggerGpx(): string {
  const start = Date.parse('2026-11-12T10:42:19Z');
  const point = (i: number, at: number): string =>
    `<trkpt lat="${String(20.3 + i * 0.0027)}" lon="105.75">` +
    `<time>${new Date(at).toISOString()}</time><hdop>1.2</hdop></trkpt>`;
  const first = Array.from({ length: 21 }, (_, i) => point(i, start + i * 30_000)).join('');
  const second = Array.from({ length: 10 }, (_, i) =>
    point(40 + i, start + 1_800_000 + i * 30_000),
  ).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<gpx version="1.1" creator="GPSLogger" xmlns="http://www.topografix.com/GPX/1/1">' +
    `<trk><name>Chuyến tắt màn hình</name><trkseg>${first}</trkseg><trkseg>${second}</trkseg></trk></gpx>`
  );
}

function gpxFile(xml: string, name = 'track.gpx'): File {
  return new File([xml], name, { type: 'application/gpx+xml' });
}

async function pick(file: File): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  await userEvent.upload(input, file);
}

describe('GPX import (RT-404)', () => {
  it('imports a background logger track, measures it, and marks it as imported', async () => {
    renderApp('/history', services);
    await screen.findByText(/Nhập hành trình từ tệp GPX/);

    await pick(gpxFile(loggerGpx()));

    const done = await screen.findByTestId('import-done');
    expect(done).toHaveTextContent('Chuyến tắt màn hình');
    expect(done).toHaveTextContent('31 điểm');

    // It appears in History, flagged, with a real measured distance.
    const row = await screen.findByText('Chuyến tắt màn hình');
    const card = row.closest('a');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Nhập từ GPX')).toBeInTheDocument();

    const trips = await services.repository.listTrips();
    const trip = trips.find((t) => t.name === 'Chuyến tắt màn hình');
    expect(trip?.importedFrom).toBe('GPX');
    expect(trip?.status).toBe('COMPLETED');
    // 20 steps of 30 s at ~36 km/h in the first segment alone — never 0, never bridged to the
    // second segment 30 minutes later.
    expect(trip?.distanceMeasuredM ?? 0).toBeGreaterThan(5_000);
    expect(trip?.distanceMeasuredM ?? 0).toBeLessThan(12_000);
  });

  it('shows the imported notice on the detail page', async () => {
    renderApp('/history', services);
    await screen.findByText(/Nhập hành trình từ tệp GPX/);
    await pick(gpxFile(loggerGpx()));
    await screen.findByTestId('import-done');

    await userEvent.click(await screen.findByText('Chuyến tắt màn hình'));
    expect(await screen.findByTestId('trip-imported')).toBeInTheDocument();
    expect(await screen.findByTestId('imported-notice')).toHaveTextContent(
      /không phải do RouteTrack đo/,
    );
  });

  it('reports a bad file and stores nothing', async () => {
    renderApp('/history', services);
    await screen.findByText(/Nhập hành trình từ tệp GPX/);

    await pick(gpxFile('this is not gpx', 'notes.gpx'));

    expect(await screen.findByTestId('import-error')).toBeInTheDocument();
    await waitFor(async () => {
      expect(await services.repository.listTrips()).toHaveLength(0);
    });
  });
});
