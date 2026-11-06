import { describe, expect, it } from 'vitest';
import { uuidV4 } from './system';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('produces RFC 4122 v4 ids', () => {
    expect(uuidV4()).toMatch(UUID_V4);
  });

  it('falls back to getRandomValues when randomUUID is unavailable (insecure context)', () => {
    const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => uuidV4()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    } finally {
      if (original) Object.defineProperty(crypto, 'randomUUID', original);
      else Reflect.deleteProperty(crypto, 'randomUUID');
    }
  });
});
