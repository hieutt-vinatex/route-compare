import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TripRepository } from '@/domain/ports';
import { TripNotEditableError } from '@/domain/trip/errors';
import { createTrip } from '@/domain/trip/tripFactory';
import { RouteTrackDb } from '../db';
import { DexieTripRepository } from './DexieTripRepository';
import { InMemoryTripRepository } from './InMemoryTripRepository';

describe.each(['Dexie', 'in-memory'])('route variants: %s (FR-19)', (implementation) => {
  let repo: TripRepository;
  let db: RouteTrackDb;
  const completed = {
    ...createTrip({ id: 't1', name: 'Đi làm', transportMode: 'WALK', startedAt: 1_000 }),
    status: 'COMPLETED' as const,
    distanceMeasuredM: 123,
  };

  beforeEach(() => {
    db = new RouteTrackDb('route-variant-test', { indexedDB: new IDBFactory(), IDBKeyRange });
    repo = implementation === 'Dexie' ? new DexieTripRepository(db) : new InMemoryTripRepository();
  });
  afterEach(() => {
    db.close();
  });

  it('trims, persists and clears a variant without changing measurement data', async () => {
    await repo.create(completed);
    await repo.setRouteVariant('t1', '  Qua đường A  ', 2_000);
    expect(await repo.getTrip('t1')).toEqual({
      ...completed,
      routeVariantLabel: 'Qua đường A',
      updatedAt: 2_000,
    });
    for (const empty of ['', '   ', null]) {
      await repo.setRouteVariant('t1', empty, 3_000);
      expect((await repo.getTrip('t1'))?.routeVariantLabel).toBeNull();
    }
    if (implementation === 'Dexie') {
      db.close();
      await db.open();
      expect((await repo.getTrip('t1'))?.routeVariantLabel).toBeNull();
    }
  });

  it('preserves another metadata edit made concurrently', async () => {
    await repo.create(completed);
    await Promise.all([
      repo.renameTrip('t1', 'Tên mới', 2_000),
      repo.setRouteVariant('t1', 'Đường B', 2_000),
    ]);
    expect(await repo.getTrip('t1')).toEqual({
      ...completed,
      name: 'Tên mới',
      routeVariantLabel: 'Đường B',
      updatedAt: 2_000,
    });
  });

  it('allows 120 trimmed characters and rejects longer labels without losing the previous value', async () => {
    await repo.create(completed);
    await repo.setRouteVariant('t1', ` ${'a'.repeat(120)} `, 2_000);
    await expect(repo.setRouteVariant('t1', 'a'.repeat(121), 3_000)).rejects.toBeInstanceOf(
      RangeError,
    );
    expect((await repo.getTrip('t1'))?.routeVariantLabel).toHaveLength(120);
    expect((await repo.getTrip('t1'))?.updatedAt).toBe(2_000);
  });

  it('rejects every unfinished status and missing trips', async () => {
    for (const status of [
      'STARTING',
      'RECORDING',
      'PAUSED',
      'FINALIZING',
      'INTERRUPTED',
    ] as const) {
      await repo.create({ ...completed, id: status, status });
      await expect(repo.setRouteVariant(status, 'Đường A', 2_000)).rejects.toBeInstanceOf(
        TripNotEditableError,
      );
    }
    await expect(repo.setRouteVariant('missing', null, 2_000)).rejects.toBeInstanceOf(
      TripNotEditableError,
    );
  });
});
