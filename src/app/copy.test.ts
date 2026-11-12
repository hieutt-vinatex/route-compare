// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lowGpsCopy } from './copy';

describe('lowGpsCopy (docs/06 §4)', () => {
  it('states whole minutes, and never rounds seconds up to “1 phút”', () => {
    expect(lowGpsCopy(3 * 60_000 + 2_000)).toBe(
      'GPS thiếu dữ liệu trong 3 phút; quãng đường hiển thị chỉ là phần đã đo được.',
    );
    expect(lowGpsCopy(2_000)).toBe(
      'GPS thiếu dữ liệu trong dưới 1 phút; quãng đường hiển thị chỉ là phần đã đo được.',
    );
  });
});
