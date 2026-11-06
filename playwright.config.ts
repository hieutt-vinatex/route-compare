import { defineConfig, devices } from '@playwright/test';

/**
 * E2E chạy trên bản build production (vite preview) với Geolocation được MÔ PHỎNG
 * (xem e2e/support/browserMocks.ts). Kết quả Playwright KHÔNG thay thế kiểm thử
 * GPS trên thiết bị thật (docs/07-TEST-PLAN.md §4).
 */
const PORT = 4173;
const isCI = Boolean(process.env.CI);

const mobile = {
  ...devices['Desktop Chrome'],
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Each test drives a real Chromium + IndexedDB; more parallelism only adds CPU contention.
  workers: 2,
  timeout: 60_000,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'mobile-360', use: { ...mobile, viewport: { width: 360, height: 740 } } },
    { name: 'mobile-390', use: { ...mobile, viewport: { width: 390, height: 844 } } },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
