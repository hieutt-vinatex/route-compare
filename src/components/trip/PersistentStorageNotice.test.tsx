import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestServices, renderApp } from '@/tests/renderApp';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

function mockStorage(granted: boolean) {
  const persist = vi.fn().mockResolvedValue(granted);
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      persisted: vi.fn().mockResolvedValue(false),
      persist,
    },
  });
  return persist;
}

describe('History persistent storage and backup (FR-23)', () => {
  it.each([true, false])(
    'requests only on a labeled user action and reports %s',
    async (granted) => {
      const persist = mockStorage(granted);
      renderApp('/history', createTestServices());
      const button = await screen.findByRole('button', {
        name: 'Yêu cầu giữ dữ liệu trên thiết bị',
      });
      expect(persist).not.toHaveBeenCalled();
      button.focus();
      await userEvent.keyboard('{Enter}');
      expect(persist).toHaveBeenCalledOnce();
      expect(
        await screen.findByText(granted ? /Đã được cấp lưu trữ bền vững/ : /Trình duyệt chưa cấp/),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Tải bản sao lưu' })).toBeVisible();
      expect(screen.getByText(/không bảo đảm lưu vĩnh viễn/)).toBeVisible();
    },
  );

  it('keeps backup available when the API is unsupported', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    renderApp('/history', createTestServices());
    expect(await screen.findByText(/không hỗ trợ yêu cầu lưu trữ bền vững/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tải bản sao lưu' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Yêu cầu giữ dữ liệu trên thiết bị' }),
    ).not.toBeInTheDocument();
  });

  it('handles a rejected browser request without blocking backup', async () => {
    mockStorage(false).mockRejectedValue(new Error('blocked'));
    renderApp('/history', createTestServices());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Yêu cầu giữ dữ liệu trên thiết bị' }),
    );
    expect(await screen.findByText(/Không kiểm tra hoặc yêu cầu được/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tải bản sao lưu' })).toBeEnabled();
  });

  it('defers the browser request while another tab records', async () => {
    const persist = mockStorage(true);
    const services = createTestServices();
    vi.spyOn(services.lock, 'heldElsewhere').mockResolvedValue(true);
    renderApp('/history', services);
    const button = await screen.findByRole('button', { name: 'Yêu cầu giữ dữ liệu trên thiết bị' });
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await userEvent.click(button);
    expect(persist).not.toHaveBeenCalled();
    expect(screen.getByText(/Chỉ yêu cầu lưu trữ sau khi kết thúc/)).toBeVisible();
  });
});
