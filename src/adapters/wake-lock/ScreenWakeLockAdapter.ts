/**
 * Screen Wake Lock (FR-16, ADR-06). Only keeps the screen on while the page is visible and the
 * system allows it; the browser releases it automatically when the page is hidden.
 * It does NOT make GPS run in the background.
 */
import type { Unsubscribe, WakeLockAdapter } from '@/domain/ports';

export class ScreenWakeLockAdapter implements WakeLockAdapter {
  private readonly getNavigator: () => Navigator | undefined;
  private sentinel: WakeLockSentinel | null = null;
  private pending: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(getNavigator: () => Navigator | undefined = () => globalThis.navigator) {
    this.getNavigator = getNavigator;
  }

  private api(): WakeLock | null {
    const nav = this.getNavigator();
    if (nav === undefined || !('wakeLock' in nav)) return null;
    return nav.wakeLock;
  }

  isSupported(): boolean {
    return this.api() !== null;
  }

  isActive(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  request(): Promise<boolean> {
    const api = this.api();
    if (api === null) return Promise.resolve(false);
    if (this.isActive()) return Promise.resolve(true);
    if (this.pending !== null) return this.pending;
    this.pending = api
      .request('screen')
      .then((sentinel) => {
        this.sentinel = sentinel;
        sentinel.addEventListener(
          'release',
          () => {
            if (this.sentinel === sentinel) this.sentinel = null;
            for (const listener of this.listeners) listener();
          },
          { once: true },
        );
        return true;
      })
      .catch(() => false)
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel !== null && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Already released by the system.
      }
    }
  }

  onRelease(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
