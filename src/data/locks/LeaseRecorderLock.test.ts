import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, ManualTimers } from '@/tests/harness';
import { RouteTrackDb } from '../db';
import { LeaseRecorderLock } from './LeaseRecorderLock';

let db: RouteTrackDb;
let clock: ManualClock;

beforeEach(() => {
  db = new RouteTrackDb('lease-test', { indexedDB: new IDBFactory(), IDBKeyRange });
  clock = new ManualClock();
});

afterEach(() => {
  db.close();
});

const tab = (owner: string, timers = new ManualTimers()) =>
  new LeaseRecorderLock({ db, clock, timers, ownerId: owner, channel: null });

describe('LeaseRecorderLock (fallback without Web Locks)', () => {
  it('only one owner holds an unexpired lease', async () => {
    const a = tab('a');
    const b = tab('b');
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await b.heldElsewhere()).toBe(true);
    expect(await a.heldElsewhere()).toBe(false);
  });

  it('the lease expires 15 s after the owner stops renewing (crashed tab)', async () => {
    const a = tab('a');
    const b = tab('b');
    await a.acquire();
    clock.advance(15_001);
    expect(await b.heldElsewhere()).toBe(false);
    expect(await b.acquire()).toBe(true);
  });

  it('renewal keeps the lease alive while the owner is running', async () => {
    const timers = new ManualTimers();
    const a = tab('a', timers);
    const b = tab('b');
    await a.acquire();
    for (let i = 0; i < 6; i += 1) {
      clock.advance(5_000);
      timers.tick();
      await a.settled();
    }
    expect(await b.acquire()).toBe(false);
  });

  it('the owner learns it lost the lease when another tab took it over (review I4)', async () => {
    const timersA = new ManualTimers();
    const a = tab('a', timersA);
    const b = tab('b');
    await a.acquire();
    let lost = 0;
    a.onLost(() => {
      lost += 1;
    });
    clock.advance(16_000); // A's timers were frozen while its page was hidden
    expect(await b.acquire()).toBe(true);
    timersA.tick();
    await a.settled();
    expect(lost).toBe(1);
    expect(await a.stillHeld()).toBe(false);
  });

  it('release frees the lease immediately and stops renewing', async () => {
    const timers = new ManualTimers();
    const a = tab('a', timers);
    await a.acquire();
    await a.release();
    expect(timers.activeIntervals).toBe(0);
    expect(await tab('b').acquire()).toBe(true);
  });
});
