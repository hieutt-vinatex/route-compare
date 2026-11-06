import { expect, test } from '@playwright/test';
import {
  cspViolations,
  eastLine,
  emit,
  installBrowserMocks,
  setVisibility,
  stubTilesAndRecordHosts,
  TILE_HOST,
} from './support/browserMocks';

// Synthetic coordinates (central Hà Nội); not a real recording.
const ORIGIN = { lat: 21.0285, lng: 105.8542 };

test.describe('permission UX (AC-01, NFR-10)', () => {
  test('denied permission shows guidance and keeps Start disabled', async ({ page }) => {
    await installBrowserMocks(page, { permission: 'denied' });
    await stubTilesAndRecordHosts(page);
    await page.goto('/');
    await expect(page.getByTestId('gps-denied')).toContainText(
      'Trình duyệt chưa được cấp quyền vị trí',
    );
    await expect(page.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
  });

  test('location is requested only after the user taps “Xác định vị trí của tôi”', async ({
    page,
  }) => {
    await installBrowserMocks(page, { permission: 'prompt' });
    await stubTilesAndRecordHosts(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Xác định vị trí của tôi' }).click();
    await expect(page.getByTestId('gps-status')).toHaveText('GPS: Đang xác định');
    await emit(page, { ...ORIGIN, accuracy: 7 });
    await expect(page.getByTestId('gps-status')).toHaveText('GPS: Sẵn sàng');
    await expect(page.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeEnabled();
  });
});

test.describe('live tracking with simulated GPS (AC-02, AC-03, AC-04, AC-10)', () => {
  test('start → record → hidden/visible → 2 unjoined segments → end → detail', async ({ page }) => {
    await installBrowserMocks(page, { permission: 'granted', wakeLock: 'missing' });
    const hosts = await stubTilesAndRecordHosts(page);
    await page.goto('/');
    await emit(page, ORIGIN);
    await expect(page.getByTestId('gps-status')).toHaveText('GPS: Sẵn sàng');

    await page.getByLabel('Phương tiện').selectOption('WALK');
    await page.getByLabel('Tên hành trình (không bắt buộc)').fill('E2E đi bộ');
    await page.getByRole('button', { name: 'Bắt đầu ghi hành trình' }).click();
    await expect(page).toHaveURL(/\/tracking$/);
    await expect(page.getByTestId('tracking-status')).toHaveText('Đang chờ GPS để bắt đầu');
    await expect(page.getByTestId('platform-limit-notice')).toBeVisible();
    await expect(page.getByTestId('wakelock-unsupported')).toBeVisible();
    expect(await page.evaluate(() => window.__rtMock.activeWatchers())).toBe(1);

    // Segment 1: 7 fixes 10 m apart (beyond the ±6 m GPS uncertainty, so the drift filter counts
    // every step). The first only calibrates the fix/app clock offset → 6 measured fixes = 50 m.
    for (const p of eastLine(ORIGIN, 7, 10, 0)) await emit(page, p);
    await expect(page.getByTestId('tracking-status')).toHaveText('Đang ghi');
    await expect(page.getByTestId('metric-distance')).toHaveText('50 m');

    // Page hidden (e.g. screen locked). A callback while hidden must not be trusted.
    await setVisibility(page, 'hidden');
    await emit(page, { lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng, offsetMs: 5_500 });
    await setVisibility(page, 'visible');
    await expect(page.getByTestId('hidden-gap-notice')).toBeVisible();

    // Segment 2 starts ~300 m north; the bridge must NOT be added.
    const north = { lat: ORIGIN.lat + 0.0027, lng: ORIGIN.lng };
    for (const p of eastLine(north, 6, 10, 6_000)) await emit(page, p);
    await expect(page.getByTestId('segment-count')).toHaveText('2');
    await expect(page.getByTestId('metric-distance')).toHaveText('100 m');
    await expect(page.locator('path.rt-segment')).toHaveCount(2);
    expect(await page.evaluate(() => window.__rtMock.activeWatchers())).toBe(1);
    // Map credits open in a new tab: a mis-tap must never navigate away from a recording.
    for (const link of await page.locator('.leaflet-control-attribution a').all()) {
      await expect(link).toHaveAttribute('target', '_blank');
    }

    await page.getByRole('button', { name: 'Kết thúc' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kết thúc' }).click();

    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'E2E đi bộ' })).toBeVisible();
    await expect(page.getByTestId('detail-distance')).toHaveText('100 m');
    await expect(page.getByTestId('detail-segments')).toHaveText('2');
    await expect(page.getByTestId('trip-incomplete')).toBeVisible();
    await expect(page.locator('path.rt-segment')).toHaveCount(2);
    const events = page.getByTestId('trip-events').locator('li');
    await expect(events.first()).toHaveAttribute('data-event-type', 'START');
    await expect(page.locator('[data-event-type="PAGE_HIDDEN"]')).toHaveCount(1);
    await expect(page.locator('[data-event-type="PAGE_VISIBLE"]')).toHaveCount(1);
    await expect(events.last()).toHaveAttribute('data-event-type', 'END');

    // Watcher released after End.
    expect(await page.evaluate(() => window.__rtMock.activeWatchers())).toBe(0);

    // Privacy (NFR-06): only the app origin and the map tile provider were contacted.
    for (const host of hosts) {
      expect([new URL(page.url()).host, TILE_HOST]).toContain(host);
    }
    // The whole flow ran under the production CSP without a single blocked resource.
    expect(await cspViolations(page)).toEqual([]);
  });

  test('permission revoked mid-trip → interrupted, can end as incomplete', async ({ page }) => {
    await installBrowserMocks(page, { permission: 'granted' });
    await stubTilesAndRecordHosts(page);
    await page.goto('/');
    await emit(page, ORIGIN);
    await page.getByRole('button', { name: 'Bắt đầu ghi hành trình' }).click();
    for (const p of eastLine(ORIGIN, 4, 5, 0)) await emit(page, p); // 1 calibration + 3
    await expect(page.getByTestId('tracking-status')).toHaveText('Đang ghi');

    await page.evaluate(() => {
      window.__rtMock.emitError(1);
    });
    await expect(page.getByTestId('interrupted-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Kết thúc (chưa đầy đủ)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kết thúc' }).click();
    await expect(page.getByTestId('trip-incomplete')).toBeVisible();
    await expect(page.getByTestId('detail-distance')).toHaveText('10 m');
  });
});
