/** Synthetic replay data imported through the normal JSON backup UI, never GPS field evidence. */
import { expect, test } from '@playwright/test';
import { createTrip } from '../src/domain/trip/tripFactory';
import type { GpsPoint } from '../src/domain/models/types';
import { installBrowserMocks, stubTilesAndRecordHosts } from './support/browserMocks';

function bundle(id: string, day: number, hour: number, label: string | null, missing = false) {
  // UTC+7 is the Playwright device timezone; all departures are local daytime.
  const startedAt = Date.UTC(2026, 10, day, hour - 7);
  const points: GpsPoint[] = missing
    ? []
    : Array.from({ length: 61 }, (_, i) => ({
        id: `${id}-p${String(i)}`,
        tripId: id,
        sourceSeq: i + 1,
        sourceTimestamp: startedAt + i * 1000,
        recordedAt: startedAt + i * 1000,
        latitude: 20.3,
        longitude: 105.75 + i * 0.000048,
        accuracyM: 5,
        speedMps: 5,
        headingDeg: null,
        segmentId: null,
        accepted: false,
        rejectCode: null,
        derivedSpeedMps: null,
      }));
  return {
    trip: {
      ...createTrip({ id, name: id, transportMode: 'MOTORBIKE', startedAt }),
      routeVariantLabel: label,
      status: 'COMPLETED',
      endedAt: startedAt + 60_000,
      elapsedMs: 60_000,
      startLat: 20.3,
      startLng: 105.75,
      endLat: 20.3,
      endLng: 105.75288,
    },
    points,
    events: [],
  };
}

test('compares real imported records, warns about conditions and summarizes all repeats', async ({
  page,
}) => {
  await installBrowserMocks(page, { permission: 'prompt' });
  await stubTilesAndRecordHosts(page);
  const trips = [
    ...Array.from({ length: 5 }, (_, i) => bundle(`Repeat A${String(i)}`, i + 1, 8, 'Đường A')),
    bundle('Different window', 6, 10, 'Đường B'),
    bundle('Missing GPS', 7, 8, null, true),
  ];
  await page.goto('/history');
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'comparison.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ app: 'routetrack', schemaVersion: 1, exportedAt: Date.now(), trips }),
    ),
  });
  await expect(page.getByTestId('restore-done')).toContainText('7');
  await page.goto('/compare');
  const stats = page.getByTestId('compare-distribution');
  await expect(stats).toContainText('5 hành trình · 5 ngày');
  await expect(stats).toContainText('Đường A');
  await expect(stats).toContainText('Độ lệch chuẩn');
  await expect(stats).toContainText('Chưa kết luận tuyến ổn định');
  await page.getByRole('checkbox', { name: /Repeat A0/ }).check();
  await page.getByRole('checkbox', { name: /Different window/ }).check();
  const table = page.getByTestId('compare-table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(page.getByTestId('compare-different-dates')).toBeVisible();
  await expect(page.getByTestId('compare-different-windows')).toBeVisible();
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
    await expect(table.getByRole('columnheader', { name, exact: true })).toBeAttached();
  }
  await expect(page.locator('.leaflet-overlay-pane path[fill="none"]')).toHaveCount(2);
  await page.getByRole('checkbox', { name: /Different window/ }).uncheck();
  await page.getByRole('checkbox', { name: /Missing GPS/ }).check();
  await expect(page.getByTestId('compare-low-coverage')).toBeVisible();
  const missing = table.getByRole('row').filter({ hasText: 'Missing GPS' });
  await expect(missing.getByText('—', { exact: true })).toHaveCount(5); // variant + four absent speeds
  await page.getByRole('checkbox', { name: /Repeat A1/ }).check();
  await page.getByRole('checkbox', { name: /Repeat A2/ }).check();
  await expect(page.getByRole('checkbox', { name: /Repeat A3/ })).toBeDisabled();
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(stats).toContainText('5 hành trình · 5 ngày');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const region = page.getByRole('region', { name: 'Bảng so sánh có thể cuộn ngang' });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
