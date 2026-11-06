import { afterEach, describe, expect, it } from 'vitest';
import { PageVisibilityAdapter } from './PageVisibilityAdapter';

let state: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

function setVisibility(next: DocumentVisibilityState): void {
  state = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  state = 'visible';
});

describe('PageVisibilityAdapter (RT-103)', () => {
  it('emits deduplicated hidden/visible transitions', () => {
    const adapter = new PageVisibilityAdapter();
    const seen: boolean[] = [];
    const unsubscribe = adapter.subscribe((v) => seen.push(v));
    setVisibility('hidden');
    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    setVisibility('visible');
    window.dispatchEvent(new Event('pageshow'));
    expect(seen).toEqual([false, true]);
    unsubscribe();
  });

  it('treats pagehide / freeze as hidden and pageshow as a visibility check', () => {
    const adapter = new PageVisibilityAdapter();
    const seen: boolean[] = [];
    const unsubscribe = adapter.subscribe((v) => seen.push(v));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('freeze'));
    document.dispatchEvent(new Event('resume'));
    expect(seen).toEqual([false, true, false, true]);
    unsubscribe();
  });

  it('stops emitting after unsubscribe', () => {
    const adapter = new PageVisibilityAdapter();
    const seen: boolean[] = [];
    adapter.subscribe((v) => seen.push(v))();
    setVisibility('hidden');
    expect(seen).toEqual([]);
    expect(adapter.isVisible()).toBe(false);
  });
});
