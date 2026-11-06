/**
 * M2 acceptance (docs/07 §3): AC-03 pause/resume, AC-05 persistence across reload + recovery,
 * AC-07 single recorder across tabs, AC-09 storage error. GPS is SIMULATED (see browserMocks);
 * the page clock is advanced by the test so fix timestamps behave like a 1 Hz receiver.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  eastLine,
  emit,
  installBrowserMocks,
  stubTilesAndRecordHosts,
  type MockPosition,
} from './support/browserMocks';

const ORIGIN = { lat: 21.0285, lng: 105.8542 };
const NORTH = { lat: ORIGIN.lat + 0.0027, lng: ORIGIN.lng };

/**
 * Controlled page clock: runFor() jumps time like a 1 Hz GPS receiver. Time also keeps flowing
 * naturally — React's scheduler, Suspense and IndexedDB need it (a frozen clock stalls the app).
 */
async function advance(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
}

async function open(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-06T08:00:00+07:00') });
  await installBrowserMocks(page, { permission: 'granted' });
  await stubTilesAndRecordHosts(page);
  await page.goto('/');
}

async function waitForWatch(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__rtMock.activeWatchers())).toBe(1);
}

/** One fix per simulated second, stamped with the simulated clock (no future timestamps). */
async function walk(page: Page, fixes: readonly MockPosition[]): Promise<void> {
  for (const fix of fixes) {
    await advance(page, 1_000);
    await emit(page, { ...fix, offsetMs: 0 });
  }
}

async function startTrip(page: Page): Promise<void> {
  await emit(page, ORIGIN);
  await expect(page.getByTestId('gps-status')).toHaveText('GPS: Sẵn sàng');
  await page.getByLabel('Phương tiện').selectOption('WALK');
  await page.getByRole('button', { name: 'Bắt đầu ghi hành trình' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await waitForWatch(page);
}

async function endTrip(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Kết thúc' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kết thúc' }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/);
}

test.describe('M2 persistence and recovery (simulated GPS)', () => {
  test('AC-05: a finished trip is still in History and Detail after a reload', async ({ page }) => {
    await open(page);
    await startTrip(page);
    // 7 fixes 10 m apart: the first calibrates the clock, 6 are measured → 50 m.
    await walk(page, eastLine(ORIGIN, 7, 10, 0));
    await advance(page, 1_000);
    await expect(page.getByTestId('metric-distance')).toHaveText('50 m');
    await endTrip(page);
    await expect(page.getByTestId('detail-distance')).toHaveText('50 m');

    await page.reload();
    await expect(page.getByTestId('detail-distance')).toHaveText('50 m');
    await expect(page.getByTestId('detail-quality')).toBeVisible();
    await page.goto('/history');
    await expect(page.getByTestId('trip-list').getByRole('link')).toHaveCount(1);
  });

  test('reload while recording → recovery → resume continues in a new segment, no bridge', async ({
    page,
  }) => {
    await open(page);
    await startTrip(page);
    await walk(page, eastLine(ORIGIN, 7, 10, 0));
    await advance(page, 1_000);
    await expect(page.getByTestId('metric-distance')).toHaveText('50 m');

    await page.reload(); // the page is gone: nothing may be invented for the closed period
    await advance(page, 30_000);
    const notice = page.getByTestId('recovery-notice');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Tiếp tục ghi (đoạn mới)' }).click();
    await expect(page).toHaveURL(/\/tracking$/);
    await waitForWatch(page);

    // ~300 m north: the jump must not be added; 6 fixes 10 m apart add 50 m.
    await walk(page, eastLine(NORTH, 6, 10, 0));
    await advance(page, 1_000);
    await expect(page.getByTestId('segment-count')).toHaveText('2');
    await expect(page.getByTestId('metric-distance')).toHaveText('100 m');

    await endTrip(page);
    await expect(page.getByTestId('trip-incomplete')).toBeVisible();
    await expect(page.locator('[data-event-type="RECOVERY"]')).toHaveCount(1);
  });

  test('AC-03: pause and resume — pause time is separate and adds no distance', async ({
    page,
  }) => {
    await open(page);
    await startTrip(page);
    await walk(page, eastLine(ORIGIN, 4, 10, 0));
    await page.getByRole('button', { name: 'Tạm dừng' }).click();
    await expect(page.getByTestId('paused-notice')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__rtMock.activeWatchers())).toBe(0);
    await advance(page, 30_000);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await waitForWatch(page);
    await walk(page, eastLine(NORTH, 4, 10, 0));
    await endTrip(page);
    // 30 s simulated + the real time the test needs to click (natural clock flow).
    await expect(page.getByTestId('detail-paused')).toHaveText(/^00:3[0-2]$/);
    await expect(page.getByTestId('detail-segments')).toHaveText('2');
    await expect(page.locator('[data-event-type="PAUSE"]')).toHaveCount(1);
    await expect(page.locator('[data-event-type="RESUME"]')).toHaveCount(1);
  });

  test('AC-09: storage full → visible error; points saved before survive a reload', async ({
    page,
  }) => {
    await open(page);
    await startTrip(page);
    await walk(page, eastLine(ORIGIN, 7, 10, 0));
    await advance(page, 1_000);
    await expect(page.getByTestId('metric-distance')).toHaveText('50 m');

    await page.evaluate(() => {
      window.__rtMock.failStorageWrites();
    });
    await walk(page, eastLine(NORTH, 2, 10, 0));
    await advance(page, 1_000);
    await expect(page.getByTestId('storage-error')).toBeVisible();

    await page.reload();
    const notice = page.getByTestId('recovery-notice');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Kết thúc (chưa đầy đủ)' }).click();
    await expect(page.getByTestId('detail-distance')).toHaveText('50 m');
    await expect(page.getByTestId('trip-incomplete')).toBeVisible();
  });
});

test.describe('AC-07: one recorder per browser', () => {
  test('a second tab cannot start while the first records, and can once it ends', async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    for (const page of [first, second]) {
      await installBrowserMocks(page, { permission: 'granted' });
      await stubTilesAndRecordHosts(page);
    }
    await first.goto('/');
    await startTrip(first);
    for (const p of eastLine(ORIGIN, 3, 10, 0)) await emit(first, p);

    await second.goto('/');
    await emit(second, ORIGIN);
    await expect(second.getByTestId('recorder-busy')).toBeVisible();
    await expect(second.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
    // The live trip of the first tab is not offered for “recovery” in the second.
    await expect(second.getByTestId('recovery-notice')).toHaveCount(0);

    await first.bringToFront();
    await endTrip(first);
    await second.bringToFront();
    await expect(second.getByTestId('recorder-busy')).toHaveCount(0);
    await expect(second.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeEnabled();
  });
});
