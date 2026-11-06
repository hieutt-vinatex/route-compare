import { describe, expect, it, vi } from 'vitest';
import { ScreenWakeLockAdapter } from './ScreenWakeLockAdapter';

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  onrelease = null;

  release(): Promise<void> {
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
    return Promise.resolve();
  }
}

function navWith(request: () => Promise<FakeSentinel>): Navigator {
  return { wakeLock: { request } } as unknown as Navigator;
}

describe('ScreenWakeLockAdapter (FR-16)', () => {
  it('is unsupported (and never throws) without navigator.wakeLock', async () => {
    const adapter = new ScreenWakeLockAdapter(() => ({}) as Navigator);
    expect(adapter.isSupported()).toBe(false);
    await expect(adapter.request()).resolves.toBe(false);
    await expect(adapter.release()).resolves.toBeUndefined();
  });

  it('resolves false when the request is rejected (e.g. NotAllowedError)', async () => {
    const adapter = new ScreenWakeLockAdapter(() =>
      navWith(() => Promise.reject(new DOMException('no', 'NotAllowedError'))),
    );
    await expect(adapter.request()).resolves.toBe(false);
    expect(adapter.isActive()).toBe(false);
  });

  it('acquires once for concurrent requests and notifies on system release', async () => {
    const sentinel = new FakeSentinel();
    const request = vi.fn(() => Promise.resolve(sentinel));
    const adapter = new ScreenWakeLockAdapter(() => navWith(request));
    const released = vi.fn();
    adapter.onRelease(released);
    const [a, b] = await Promise.all([adapter.request(), adapter.request()]);
    expect(a && b).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(adapter.isActive()).toBe(true);
    await sentinel.release(); // e.g. page hidden
    expect(released).toHaveBeenCalledTimes(1);
    expect(adapter.isActive()).toBe(false);
  });

  it('manual release releases the sentinel', async () => {
    const sentinel = new FakeSentinel();
    const adapter = new ScreenWakeLockAdapter(() => navWith(() => Promise.resolve(sentinel)));
    await adapter.request();
    await adapter.release();
    expect(sentinel.released).toBe(true);
    expect(adapter.isActive()).toBe(false);
  });
});
