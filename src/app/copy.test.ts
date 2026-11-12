// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lowGpsCopy } from './copy';

describe('lowGpsCopy (docs/06 §4)', () => {
  it('states whole minutes, and never rounds seconds up to “1 phút”', () => {
    expect(lowGpsCopy(3 * 60_000 + 2_000)).toBe(
      'Có 3 phút không xác định được đang đi hay dừng (mất GPS hoặc GPS chưa đủ chính xác); quãng đường hiển thị chỉ là phần đã đo được.',
    );
    expect(lowGpsCopy(2_000)).toBe(
      'Có dưới 1 phút không xác định được đang đi hay dừng (mất GPS hoặc GPS chưa đủ chính xác); quãng đường hiển thị chỉ là phần đã đo được.',
    );
  });
});
