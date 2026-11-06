import type { Unsubscribe, WakeLockAdapter } from '@/domain/ports';

export class MockWakeLockAdapter implements WakeLockAdapter {
  supported = true;
  /** When true, request() resolves false (e.g. battery saver / permission policy). */
  denyRequests = false;
  requestCount = 0;
  /** When true, request() stays pending until resolvePending() (slow permission/OS). */
  deferRequests = false;
  private pending: (() => void) | null = null;
  private active = false;
  private readonly listeners = new Set<() => void>();

  isSupported(): boolean {
    return this.supported;
  }

  isActive(): boolean {
    return this.active;
  }

  request(): Promise<boolean> {
    this.requestCount += 1;
    if (!this.supported || this.denyRequests) return Promise.resolve(false);
    if (this.deferRequests) {
      return new Promise((resolve) => {
        this.pending = () => {
          this.active = true;
          resolve(true);
        };
      });
    }
    this.active = true;
    return Promise.resolve(true);
  }

  resolvePending(): void {
    this.pending?.();
    this.pending = null;
  }

  release(): Promise<void> {
    if (this.active) this.fireRelease();
    return Promise.resolve();
  }

  /** Simulate the browser releasing the lock (page hidden, battery saver…). */
  systemRelease(): void {
    if (this.active) this.fireRelease();
  }

  onRelease(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fireRelease(): void {
    this.active = false;
    for (const listener of this.listeners) listener();
  }
}
