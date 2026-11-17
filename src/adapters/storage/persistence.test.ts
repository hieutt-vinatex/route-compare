import { describe, expect, it, vi } from 'vitest';
import { readPersistence, requestPersistence } from './persistence';

describe('browser persistent storage (FR-23)', () => {
  it('reads current status without requesting permission', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn() };
    expect(await readPersistence(storage)).toBe('best-effort');
    expect(storage.persist).not.toHaveBeenCalled();
    storage.persisted.mockResolvedValue(true);
    expect(await readPersistence(storage)).toBe('persistent');
    expect(await requestPersistence(storage)).toBe('persistent');
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it.each([true, false])('reports the actual request result %s', async (granted) => {
    const storage = {
      persisted: () => Promise.resolve(false),
      persist: vi.fn().mockResolvedValue(granted),
    };
    expect(await requestPersistence(storage)).toBe(granted ? 'persistent' : 'denied');
    expect(storage.persist).toHaveBeenCalledOnce();
  });

  it('degrades when storage is unavailable, incomplete or throws', async () => {
    for (const storage of [undefined, null, {}, { persisted: () => Promise.resolve(false) }]) {
      expect(await readPersistence(storage)).toBe('unsupported');
      expect(await requestPersistence(storage)).toBe('unsupported');
    }
    const storage = {
      persisted: vi.fn().mockRejectedValue(new Error('blocked')),
      persist: vi.fn().mockRejectedValue(new Error('blocked')),
    };
    expect(await readPersistence(storage)).toBe('error');
    expect(await requestPersistence(storage)).toBe('error');
    storage.persisted.mockResolvedValue(false);
    expect(await requestPersistence(storage)).toBe('error');
  });
});
