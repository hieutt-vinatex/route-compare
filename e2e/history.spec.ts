/**
 * M3 acceptance: History search/filter (FR-09), Trip Detail chart + formulas (FR-10, RT-302/303),
 * rename and delete (FR-14, AC-08). GPS is SIMULATED (browserMocks) on a controlled page clock;
 * this is not a real-device GPS test.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  cspViolations,
  eastLine,
  emit,
  installBrowserMocks,
  stubTilesAndRecordHosts,
  type MockPosition,
} from './support/browserMocks';

const ORIGIN = { lat: 21.0285, lng: 105.8542 };
const NORTH = { lat: ORIGIN.lat + 0.0027, lng: ORIGIN.lng };

async function open(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-06T08:00:00+07:00') });
  await installBrowserMocks(page, { permission: 'granted' });
  await stubTilesAndRecordHosts(page);
  await page.goto('/');
}

/** One fix per simulated second, stamped with the simulated clock. */
async function walk(page: Page, fixes: readonly MockPosition[]): Promise<void> {
  for (const fix of fixes) {
    await page.clock.runFor(1_000);
    await emit(page, { ...fix, offsetMs: 0 });
  }
}

async function recordTrip(
  page: Page,
  name: string,
  mode: 'WALK' | 'MOTORBIKE',
  from: MockPosition,
): Promise<void> {
  await page.goto('/');
  await emit(page, from);
  await expect(page.getByTestId('gps-status')).toHaveText('GPS: Sẵn sàng');
  await page.getByLabel('Phương tiện').selectOption(mode);
  await page.getByLabel('Tên hành trình (không bắt buộc)').fill(name);
  await page.getByRole('button', { name: 'Bắt đầu ghi hành trình' }).click();
  await expect(page).toHaveURL(/\/tracking$/);
  await expect.poll(() => page.evaluate(() => window.__rtMock.activeWatchers())).toBe(1);
  await walk(page, eastLine(from, 15, 10, 0));
  await expect(page.getByTestId('tracking-status')).toHaveText('Đang ghi');
  await page.getByRole('button', { name: 'Kết thúc' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Kết thúc' }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const rows = (page: Page) => page.getByTestId('trip-list').getByRole('listitem');

/** Mobile 360/390 px: no horizontal page scroll (docs/06 §8). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

test.describe('M3 history and trip detail (simulated GPS)', () => {
  test('detail chart and formulas, then search and filter two trips — under the production CSP', async ({
    page,
  }) => {
    await open(page);
    await recordTrip(page, 'Đi bộ buổi sáng', 'WALK', ORIGIN);

    // RT-303: the lazily loaded Chart.js canvas, described for screen readers.
    await expect(page.getByRole('heading', { name: 'Tốc độ theo thời gian' })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Tốc độ theo thời gian\./ })).toBeVisible();
    await expect(page.getByTestId('speed-chart-legend')).toContainText('Tốc độ (km/h)');
    // RT-302: formulas on demand.
    await page.getByText('Cách tính các số liệu').click();
    await expect(page.getByTestId('formula-notes')).toContainText(
      'Độ phủ GPS = (Di chuyển + Dừng) ÷ (Tổng thời gian − Tạm dừng)',
    );
    await expectNoHorizontalScroll(page);

    await recordTrip(page, 'Xe máy đi làm', 'MOTORBIKE', NORTH);

    await page.goto('/history');
    await expect(rows(page)).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await page.getByRole('searchbox', { name: 'Tìm theo tên' }).fill('di bo');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Đi bộ buổi sáng');
    await expect(page).toHaveURL(/\?q=di\+bo$/);

    await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel('Phương tiện').selectOption('MOTORBIKE');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Xe máy đi làm');

    // Chart.js and the new pages add no inline script/style and no third-party request.
    expect(await cspViolations(page)).toEqual([]);
  });

  test('AC-08: rename, then delete with confirmation — gone after a reload', async ({ page }) => {
    await open(page);
    await recordTrip(page, 'Chuyến thử', 'WALK', ORIGIN);

    await page.getByRole('button', { name: 'Đổi tên' }).click();
    const rename = page.getByRole('dialog', { name: 'Đổi tên hành trình' });
    await rename.getByLabel('Tên hành trình').fill('Chuyến đã đổi tên');
    await rename.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Chuyến đã đổi tên' })).toBeVisible();

    await page.getByRole('button', { name: 'Xóa hành trình' }).click();
    const confirm = page.getByRole('dialog', { name: 'Xóa hành trình này?' });
    await expect(confirm).toContainText('Không thể hoàn tác');
    await confirm.getByRole('button', { name: 'Xóa' }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByText('Chưa có hành trình.', { exact: false })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Chưa có hành trình.', { exact: false })).toBeVisible();
    expect(await cspViolations(page)).toEqual([]);
  });
});
