/**
 * Recorder lock over the Web Locks API (RT-206). The lock is held for as long as this tab records
 * and is released automatically by the browser when the tab closes or crashes.
 */
import type { RecorderLock, Unsubscribe } from '@/domain/ports';

export const RECORDER_LOCK_NAME = 'routetrack-recorder';

export class WebLocksRecorderLock implements RecorderLock {
  private readonly getNavigator: () => Navigator;
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Set<() => void>();
  private releaseHeld: (() => void) | null = null;
  private pending: Promise<boolean> | null = null;

  static isSupported(
    getNavigator: () => Navigator | undefined = () => globalThis.navigator,
  ): boolean {
    const nav = getNavigator();
    return nav !== undefined && 'locks' in nav;
  }

  constructor(getNavigator: () => Navigator, channel: BroadcastChannel | null) {
    this.getNavigator = getNavigator;
    this.channel = channel;
    channel?.addEventListener('message', () => {
      for (const listener of this.listeners) listener();
    });
  }

  acquire(): Promise<boolean> {
    if (this.releaseHeld !== null) return Promise.resolve(true);
    if (this.pending !== null) return this.pending;
    const locks = this.getNavigator().locks;
    const attempt = new Promise<boolean>((resolve) => {
      locks
        .request(RECORDER_LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (lock === null) {
            resolve(false);
            return undefined;
          }
          // Keep the lock until release() resolves this promise.
          return new Promise<void>((release) => {
            this.releaseHeld = release;
            resolve(true);
          });
        })
        .catch(() => {
          resolve(false);
        });
    });
    this.pending = attempt
      .then((ok) => {
        if (ok) this.channel?.postMessage('acquired');
        return ok;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  release(): Promise<void> {
    if (this.releaseHeld !== null) {
      this.releaseHeld();
      this.releaseHeld = null;
      this.channel?.postMessage('released');
    }
    return Promise.resolve();
  }

  async heldElsewhere(): Promise<boolean> {
    if (this.releaseHeld !== null) return false;
    try {
      const snapshot = await this.getNavigator().locks.query();
      return (snapshot.held ?? []).some((lock) => lock.name === RECORDER_LOCK_NAME);
    } catch {
      return false;
    }
  }

  /** A Web Lock is held until released or the tab dies — it cannot be taken over. */
  stillHeld(): Promise<boolean> {
    return Promise.resolve(this.releaseHeld !== null);
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onLost(): Unsubscribe {
    return () => undefined;
  }
}
