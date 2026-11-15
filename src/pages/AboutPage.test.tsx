/**
 * Privacy / limitations page (RT-503). These assertions are the promises the app makes; they must
 * fail loudly if the copy ever drifts into claiming background recording or cloud storage.
 */
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '@/app/copy';
import { createTestServices, renderApp, type TestServices } from '@/tests/renderApp';

let services: TestServices;

beforeEach(() => {
  services = createTestServices();
});

describe('About / privacy page', () => {
  it('states the platform limit with the same wording as the recording screens', async () => {
    renderApp('/about', services);
    expect(await screen.findByTestId('about-platform-limit')).toHaveTextContent(
      COPY.platformDetail,
    );
  });

  it('says the data never leaves the device and can be lost', async () => {
    renderApp('/about', services);
    expect(await screen.findByText(/không rời khỏi thiết bị/)).toBeInTheDocument();
    expect(await screen.findByText(/mất hết/)).toBeInTheDocument();
  });

  it('never claims the service worker records GPS', async () => {
    renderApp('/about', services);
    const text = (await screen.findByRole('main')).textContent;
    expect(text).toMatch(/không bao giờ/);
    expect(text).not.toMatch(/ghi nền|chạy nền khi khóa màn hình/);
  });

  it('credits OpenStreetMap', async () => {
    renderApp('/about', services);
    expect((await screen.findAllByText(/OpenStreetMap/)).length).toBeGreaterThan(0);
  });

  it('is reachable from the footer of the app', async () => {
    renderApp('/history', services);
    expect(
      await screen.findByRole('link', { name: 'Giới thiệu, quyền riêng tư và giới hạn' }),
    ).toBeInTheDocument();
  });
});
