import { expect, test } from '@playwright/test';
import { installBrowserMocks, TILE_HOST } from './support/browserMocks';

// This suite installs and controls the real production Service Worker.
test.use({ serviceWorkers: 'allow' });

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="offline-test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Offline saved trip</name><trkseg>${Array.from({ length: 12 }, (_, i) => `<trkpt lat="${20.3 + i * 0.0001}" lon="${105.75 + i * 0.0001}"><time>${new Date(Date.UTC(2026, 10, 12, 10, 0, i * 5)).toISOString()}</time><hdop>1.2</hdop></trkpt>`).join('')}</trkseg></trk></gpx>`;

test('installed app shell opens saved history and detail offline without tiles (NFR-05)', async ({
  page,
  context,
}) => {
  await installBrowserMocks(page, { permission: 'prompt' });
  // Always fail map tiles: no live provider requests and no cached tile dependency.
  await context.route(`**://${TILE_HOST}/**`, (route) => route.abort());
  await page.goto('/history');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await page.getByLabel('Chọn tệp GPX', { exact: true }).setInputFiles({
    name: 'offline.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(GPX),
  });
  await expect(page.getByTestId('import-done')).toContainText('Offline saved trip');
  await page.getByRole('link', { name: /Offline saved trip/ }).click();
  await expect(page.getByTestId('detail-distance')).toBeVisible();
  const measuredDistance = await page.getByTestId('detail-distance').textContent();
  const detailPath = new URL(page.url()).pathname;

  await context.setOffline(true);
  await page.goto('/history');
  await expect(page.getByRole('link', { name: /Offline saved trip/ })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: /Offline saved trip/ }).click();
  await expect(page.getByTestId('detail-distance')).toHaveText(measuredDistance ?? '');
  await page.reload();
  expect(new URL(page.url()).pathname).toBe(detailPath);
  await expect(page.getByTestId('detail-distance')).toHaveText(measuredDistance ?? '');
  await expect(page.getByText(/không tải được|không có mạng|chưa tải được/i).first()).toBeVisible();
  await expect(page.locator('.rt-segment').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const cacheUrls = await page.evaluate(async () => {
    const cachesList = await caches.keys();
    return (
      await Promise.all(
        cachesList.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => request.url),
        ),
      )
    ).flat();
  });
  expect(cacheUrls.some((url) => url.includes('index.html'))).toBe(true);
  expect(cacheUrls.some((url) => url.includes(TILE_HOST))).toBe(false);
});
