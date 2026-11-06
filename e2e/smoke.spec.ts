import { expect, test } from '@playwright/test';
import { installBrowserMocks, stubTilesAndRecordHosts } from './support/browserMocks';

const PLATFORM_HINT =
  'Để ghi liên tục, giữ trang này hiển thị. Trình duyệt có thể ngừng GPS khi khóa màn hình.';

test.describe('smoke (RT-002, NFR-01, NFR-11)', () => {
  test.beforeEach(async ({ page }) => {
    await installBrowserMocks(page, { permission: 'prompt' });
    await stubTilesAndRecordHosts(page);
  });

  for (const width of [360, 390, 768, 1280]) {
    test(`all routes render without login and without horizontal scroll at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/', '/tracking', '/history', '/compare', '/trips/khong-co']) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${path} @ ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('home shows the background-GPS limitation and never asks for location on load', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('platform-limit-notice')).toContainText(PLATFORM_HINT);
    await expect(page.getByTestId('gps-status')).toHaveText('GPS: Chưa cấp quyền');
    await expect(page.getByRole('button', { name: 'Bắt đầu ghi hành trình' })).toBeDisabled();
    expect(await page.evaluate(() => window.__rtMock.watchCalls())).toBe(0);
  });

  test('navigation between Trang chủ / Lịch sử / So sánh', async ({ page }) => {
    await page.goto('/');
    const nav = page
      .getByRole('navigation', { name: /Điều hướng chính/ })
      .filter({ visible: true })
      .first();
    await nav.getByRole('link', { name: 'Lịch sử' }).click();
    await expect(page.getByRole('heading', { name: 'Lịch sử' })).toBeVisible();
    await nav.getByRole('link', { name: 'So sánh' }).click();
    await expect(page.getByRole('heading', { name: 'So sánh' })).toBeVisible();
    await nav.getByRole('link', { name: 'Trang chủ' }).click();
    await expect(page.getByRole('heading', { name: 'Ghi hành trình' })).toBeVisible();
  });
});
