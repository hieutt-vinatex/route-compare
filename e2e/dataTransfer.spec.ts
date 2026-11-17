/**
 * M4/M5 surfaces in a real browser (RT-404, RT-501, RT-503): import a GPX, back the database up
 * and restore it, and confirm the service worker caches the app shell without touching tiles.
 */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { haversineM } from '../src/domain/geo/haversine';
import { installBrowserMocks, stubTilesAndRecordHosts } from './support/browserMocks';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Chuyen nhap E2E</name><trkseg>
${Array.from({ length: 21 }, (_, i) => {
  const at = new Date(Date.UTC(2026, 10, 12, 10, 0, i * 30)).toISOString();
  return `<trkpt lat="${20.3 + i * 0.0027}" lon="105.75"><time>${at}</time><hdop>1.2</hdop></trkpt>`;
}).join('')}
</trkseg></trk></gpx>`;

test.describe('import, backup and restore (RT-404)', () => {
  test.beforeEach(async ({ page }) => {
    await installBrowserMocks(page, { permission: 'prompt' });
    await stubTilesAndRecordHosts(page);
  });

  test('imports a GPX, marks it, and survives a reload', async ({ page }) => {
    await page.goto('/history');
    await page.locator('input[type="file"][accept*="gpx"]').setInputFiles({
      name: 'track.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(GPX),
    });

    await expect(page.getByTestId('import-done')).toContainText('Chuyen nhap E2E');
    await expect(page.getByText('Nhập từ GPX').first()).toBeVisible();

    await page.reload();
    await expect(page.getByText('Chuyen nhap E2E')).toBeVisible();

    // The detail page recomputes from the file's own sampling rate: a real distance, not 0 m.
    await page.getByRole('link', { name: /Chuyen nhap E2E/ }).click();
    await expect(page.getByTestId('trip-imported')).toBeVisible();
    await expect(page.getByTestId('detail-distance')).not.toContainText('0 m');
  });

  test('backs up and restores without overwriting an existing trip', async ({ page }) => {
    await page.goto('/history');
    await page.locator('input[type="file"][accept*="gpx"]').setInputFiles({
      name: 'track.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(GPX),
    });
    await expect(page.getByTestId('import-done')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải bản sao lưu' }).click();
    const file = await download;
    const path = await file.path();
    await expect(page.getByTestId('backup-done')).toContainText('1 hành trình');

    // Restoring the same backup must add nothing and change nothing.
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(path);
    await expect(page.getByTestId('restore-done')).toContainText('bỏ qua 1');
  });

  test('saves a road variant and downloads endpoint-private CSV and GPX (FR-19, FR-22)', async ({
    page,
  }) => {
    await page.goto('/history');
    await page.locator('input[type="file"][accept*="gpx"]').setInputFiles({
      name: 'track.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(GPX),
    });
    await expect(page.getByTestId('import-done')).toBeVisible();
    await page.getByRole('link', { name: /Chuyen nhap E2E/ }).click();
    await page.getByLabel('Phương án đường', { exact: true }).fill('Qua đường A');
    await page.getByRole('button', { name: 'Lưu phương án đường' }).click();
    await expect(page.getByText('Đã lưu phương án đường.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Phương án đường', { exact: true })).toHaveValue('Qua đường A');
    await page.getByLabel('Ẩn đầu/cuối khi xuất (m)').fill('500');
    await expect(page.getByRole('button', { name: 'JSON', exact: true })).toBeDisabled();
    for (const format of ['CSV', 'GPX']) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: format, exact: true }).click();
      const file = await pending;
      const path = await file.path();
      const text = await readFile(path, 'utf8');
      const coordinates =
        format === 'CSV'
          ? text
              .trimEnd()
              .split('\n')
              .slice(1)
              .map((line) => {
                const cells = line.split(',');
                return { lat: Number(cells[3]), lng: Number(cells[4]) };
              })
          : [...text.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((match) => ({
              lat: Number(match[1]),
              lng: Number(match[2]),
            }));
      expect(coordinates.length).toBeGreaterThan(0);
      expect(coordinates.length).toBeLessThan(21);
      for (const p of coordinates) {
        expect(haversineM(p, { lat: 20.3, lng: 105.75 })).toBeGreaterThan(500);
        expect(haversineM(p, { lat: 20.3 + 20 * 0.0027, lng: 105.75 })).toBeGreaterThan(500);
      }
    }
    await page.getByLabel('Ẩn đầu/cuối khi xuất (m)').fill('100000');
    await page.getByRole('button', { name: 'GPX', exact: true }).click();
    await expect(page.getByTestId('trip-export-error')).toContainText('Không còn điểm');
  });
});

test.describe('PWA app shell (RT-501)', () => {
  test('serves a manifest and a service worker that never caches map tiles', async ({
    page,
    baseURL,
  }) => {
    const manifest = await page.request.get(`${baseURL ?? ''}/manifest.webmanifest`);
    expect(manifest.ok()).toBeTruthy();
    const parsed = (await manifest.json()) as { display?: string };
    expect(parsed.display).toBe('standalone');

    const sw = await page.request.get(`${baseURL ?? ''}/sw.js`);
    expect(sw.ok()).toBeTruthy();
    const source = await sw.text();
    expect(source).not.toMatch(/tile\.|openstreetmap/i);
    expect(source).not.toMatch(/geolocation/i);
  });
});
