import { describe, expect, it } from 'vitest';
import { RECORDER_LOCK_NAME, WebLocksRecorderLock } from './WebLocksRecorderLock';

/** Minimal in-memory LockManager shared by several “tabs”. */
class FakeLockManager {
  private readonly held = new Set<string>();

  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<void> | void,
  ): Promise<void> {
    if (this.held.has(name)) {
      if (options.ifAvailable === true) return Promise.resolve(callback(null));
      return Promise.reject(new Error('fake manager only supports ifAvailable'));
    }
    this.held.add(name);
    return Promise.resolve(callback({ name })).finally(() => {
      this.held.delete(name);
    });
  }

  query(): Promise<{ held: { name: string }[] }> {
    return Promise.resolve({ held: [...this.held].map((name) => ({ name })) });
  }
}

const tab = (locks: FakeLockManager) =>
  new WebLocksRecorderLock(() => ({ locks }) as unknown as Navigator, null);

describe('WebLocksRecorderLock (RT-206, FR-13)', () => {
  it('only one tab can hold the recorder lock', async () => {
    const locks = new FakeLockManager();
    const a = tab(locks);
    const b = tab(locks);
    expect(await a.acquire()).toBe(true);
    expect(await a.acquire()).toBe(true); // idempotent for the owner
    expect(await b.acquire()).toBe(false);
    expect(await b.heldElsewhere()).toBe(true);
    expect(await a.heldElsewhere()).toBe(false);
  });

  it('releasing lets another tab take over', async () => {
    const locks = new FakeLockManager();
    const a = tab(locks);
    const b = tab(locks);
    await a.acquire();
    await a.release();
    await Promise.resolve();
    expect(await b.heldElsewhere()).toBe(false);
    expect(await b.acquire()).toBe(true);
    expect((await locks.query()).held).toEqual([{ name: RECORDER_LOCK_NAME }]);
  });

  it('reports unsupported without navigator.locks', () => {
    expect(WebLocksRecorderLock.isSupported(() => ({}) as Navigator)).toBe(false);
  });
});
