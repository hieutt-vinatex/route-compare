import type { RecorderLock, Unsubscribe } from '@/domain/ports';

/** Test double: `heldByOtherTab` simulates another tab recording. */
export class MockRecorderLock implements RecorderLock {
  heldByOtherTab = false;
  held = false;
  /** What stillHeld() answers while this tab holds the lock. */
  stillHeldResult = true;
  private readonly listeners = new Set<() => void>();
  private readonly lostListeners = new Set<() => void>();

  acquire(): Promise<boolean> {
    if (this.heldByOtherTab) return Promise.resolve(false);
    this.held = true;
    return Promise.resolve(true);
  }

  release(): Promise<void> {
    this.held = false;
    return Promise.resolve();
  }

  heldElsewhere(): Promise<boolean> {
    return Promise.resolve(this.heldByOtherTab);
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stillHeld(): Promise<boolean> {
    return Promise.resolve(this.held && this.stillHeldResult);
  }

  onLost(listener: () => void): Unsubscribe {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /** Simulate another tab taking over (e.g. an expired lease). */
  loseLock(): void {
    this.held = false;
    this.heldByOtherTab = true;
    for (const listener of this.lostListeners) listener();
  }

  setHeldByOtherTab(value: boolean): void {
    this.heldByOtherTab = value;
    for (const listener of this.listeners) listener();
  }
}
