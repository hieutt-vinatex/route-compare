/**
 * Fallback recorder lock when the Web Locks API is missing (RT-206): a lease row in IndexedDB,
 * renewed every 5 s and considered abandoned 15 s after the last renewal (crashed/closed tab).
 */
import type { Clock, RecorderLock, Timers, Unsubscribe } from '@/domain/ports';
import type { RouteTrackDb } from '../db';

const LEASE_NAME = 'recorder';
export const LEASE_TTL_MS = 15_000;
export const LEASE_RENEW_MS = 5_000;

export interface LeaseRecorderLockOptions {
  readonly db: RouteTrackDb;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly ownerId: string;
  readonly channel: BroadcastChannel | null;
}

export class LeaseRecorderLock implements RecorderLock {
  private readonly options: LeaseRecorderLockOptions;
  private readonly listeners = new Set<() => void>();
  private readonly lostListeners = new Set<() => void>();
  private renewHandle: unknown = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: LeaseRecorderLockOptions) {
    this.options = options;
    options.channel?.addEventListener('message', () => {
      for (const listener of this.listeners) listener();
    });
  }

  async acquire(): Promise<boolean> {
    const { db, clock, ownerId } = this.options;
    const ok = await db.transaction('rw', db.recorderLease, async () => {
      const row = await db.recorderLease.get(LEASE_NAME);
      const now = clock.now();
      if (row !== undefined && row.ownerId !== ownerId && row.expiresAt > now) return false;
      await db.recorderLease.put({ name: LEASE_NAME, ownerId, expiresAt: now + LEASE_TTL_MS });
      return true;
    });
    if (ok && this.renewHandle === null) {
      this.renewHandle = this.options.timers.setInterval(() => {
        this.chain = this.chain.then(() => this.renew()).catch(() => undefined);
      }, LEASE_RENEW_MS);
      this.options.channel?.postMessage('acquired');
    }
    return ok;
  }

  async release(): Promise<void> {
    const { db, ownerId, timers } = this.options;
    if (this.renewHandle !== null) {
      timers.clearInterval(this.renewHandle);
      this.renewHandle = null;
    }
    await db.transaction('rw', db.recorderLease, async () => {
      const row = await db.recorderLease.get(LEASE_NAME);
      if (row?.ownerId === ownerId) await db.recorderLease.delete(LEASE_NAME);
    });
    this.options.channel?.postMessage('released');
  }

  async heldElsewhere(): Promise<boolean> {
    const row = await this.options.db.recorderLease.get(LEASE_NAME);
    return (
      row !== undefined &&
      row.ownerId !== this.options.ownerId &&
      row.expiresAt > this.options.clock.now()
    );
  }

  /**
   * Still ours? An expired lease nobody else took is quietly renewed; a lease another tab took is
   * lost (review I4) — the caller must stop writing.
   */
  async stillHeld(): Promise<boolean> {
    const held = await this.refresh();
    if (!held) this.markLost();
    return held;
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onLost(listener: () => void): Unsubscribe {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /** Resolves once pending renewals are written (tests). */
  settled(): Promise<void> {
    return this.chain;
  }

  private async renew(): Promise<void> {
    if (!(await this.refresh())) this.markLost();
  }

  /** Extend our lease if it is still ours (expired or not); false when another owner holds it. */
  private async refresh(): Promise<boolean> {
    const { db, clock, ownerId } = this.options;
    return db.transaction('rw', db.recorderLease, async () => {
      const row = await db.recorderLease.get(LEASE_NAME);
      const now = clock.now();
      const ours = row?.ownerId === ownerId;
      const free = row === undefined || row.expiresAt <= now;
      if (!ours && !free) return false;
      if (!ours && this.renewHandle === null) return false; // we never held it / already released
      await db.recorderLease.put({ name: LEASE_NAME, ownerId, expiresAt: now + LEASE_TTL_MS });
      return true;
    });
  }

  private markLost(): void {
    if (this.renewHandle === null) return;
    this.options.timers.clearInterval(this.renewHandle);
    this.renewHandle = null;
    for (const listener of this.lostListeners) listener();
  }
}
