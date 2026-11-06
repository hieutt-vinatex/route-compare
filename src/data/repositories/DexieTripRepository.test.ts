import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GpsPoint, Trip, TripEvent, TripEventType } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import { RouteTrackDb, SCHEMA_V1 } from '../db';
import { DexieTripRepository } from './DexieTripRepository';

let factory: IDBFactory;
let db: RouteTrackDb;
let repo: DexieTripRepository;

const open = (): RouteTrackDb =>
  new RouteTrackDb('routetrack-test', { indexedDB: factory, IDBKeyRange });

beforeEach(() => {
  factory = new IDBFactory(); // a brand-new, empty IndexedDB per test
  db = open();
  repo = new DexieTripRepository(db);
});

afterEach(() => {
  db.close();
});

const trip = (id = 't1', patch: Partial<Trip> = {}): Trip => ({
  ...createTrip({ id, name: `Trip ${id}`, transportMode: 'WALK', startedAt: 1_000 }),
  ...patch,
});

const point = (sourceSeq: number, tripId = 't1', id = `${tripId}-p${sourceSeq}`): GpsPoint => ({
  id,
  tripId,
  sourceSeq,
  sourceTimestamp: 1_000 + sourceSeq * 1_000,
  recordedAt: 1_200 + sourceSeq * 1_000,
  latitude: 21.0285,
  longitude: 105.8542,
  accuracyM: 5,
  speedMps: null,
  headingDeg: null,
  segmentId: null,
  accepted: false,
  rejectCode: null,
  derivedSpeedMps: null,
});

const event = (seq: number, type: TripEventType, timestamp = 5_000, tripId = 't1'): TripEvent => ({
  id: `${tripId}-e${seq}`,
  tripId,
  seq,
  timestamp,
  type,
  metadata: null,
});

describe('DexieTripRepository (RT-201)', () => {
  it('create/get/update round-trips a trip', async () => {
    await repo.create(trip());
    await repo.updateTrip({ ...trip(), status: 'RECORDING', startLat: 21 });
    expect(await repo.getTrip('t1')).toMatchObject({ id: 't1', status: 'RECORDING', startLat: 21 });
  });

  it('never downgrades a COMPLETED trip (late writer, other tab) (review I1)', async () => {
    await repo.create(trip());
    await repo.updateTrip({ ...trip(), status: 'COMPLETED', metricsVersion: 1 });
    await expect(repo.updateTrip({ ...trip(), status: 'RECORDING' })).rejects.toThrow();
    expect((await repo.getTrip('t1'))?.status).toBe('COMPLETED');
  });

  it('refuses to create the same trip twice and to update a missing trip', async () => {
    await repo.create(trip());
    await expect(repo.create(trip())).rejects.toThrow();
    await expect(repo.updateTrip(trip('missing'))).rejects.toThrow();
  });

  it('appendRawPoint is idempotent for the same id', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    await repo.appendRawPoint(point(1));
    expect(await repo.listPoints('t1')).toHaveLength(1);
  });

  it('rejects a second point with the same [tripId+sourceSeq] (D1)', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    await expect(repo.appendRawPoint(point(1, 't1', 'other-id'))).rejects.toThrow();
  });

  it('never stores a point or event for a trip that does not exist (no orphans)', async () => {
    await expect(repo.appendRawPoint(point(1, 'ghost'))).rejects.toThrow();
    await expect(repo.appendEvent(event(1, 'START', 0, 'ghost'))).rejects.toThrow();
  });

  it('recordProcessingResult updates only the processing fields', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    await repo.recordProcessingResult('t1-p1', {
      accepted: true,
      rejectCode: null,
      segmentId: 1,
      derivedSpeedMps: 4.5,
    });
    const [p] = await repo.listPoints('t1');
    expect(p).toMatchObject({
      accepted: true,
      segmentId: 1,
      derivedSpeedMps: 4.5,
      latitude: 21.0285,
    });
    await expect(
      repo.recordProcessingResult('nope', {
        accepted: false,
        rejectCode: 'RANGE',
        segmentId: null,
        derivedSpeedMps: null,
      }),
    ).rejects.toThrow();
  });

  it('lists points by sourceSeq and events by seq, even when timestamps tie (D2)', async () => {
    await repo.create(trip());
    for (const seq of [3, 1, 2]) await repo.appendRawPoint(point(seq));
    await repo.appendEvent(event(5, 'PAGE_VISIBLE', 9_000));
    await repo.appendEvent(event(4, 'PAGE_HIDDEN', 9_000));
    await repo.appendEvent(event(1, 'START', 1_000));
    expect((await repo.listPoints('t1')).map((p) => p.sourceSeq)).toEqual([1, 2, 3]);
    expect((await repo.listEvents('t1')).map((e) => e.type)).toEqual([
      'START',
      'PAGE_HIDDEN',
      'PAGE_VISIBLE',
    ]);
  });

  it('lists trips newest first and active trips separately', async () => {
    await repo.create(trip('old', { startedAt: 1_000, status: 'COMPLETED' }));
    await repo.create(trip('new', { startedAt: 9_000, status: 'COMPLETED' }));
    await repo.create(trip('live', { startedAt: 5_000, status: 'RECORDING' }));
    expect((await repo.listTrips()).map((t) => t.id)).toEqual(['new', 'live', 'old']);
    expect((await repo.listActiveTrips()).map((t) => t.id)).toEqual(['live']);
  });

  it('deleteTripCascade removes the trip, its points and events, and nothing else', async () => {
    await repo.create(trip('a'));
    await repo.create(trip('b'));
    await repo.appendRawPoint(point(1, 'a'));
    await repo.appendRawPoint(point(1, 'b'));
    await repo.appendEvent(event(2, 'START', 0, 'a'));
    await repo.deleteTripCascade('a');
    expect(await repo.getTrip('a')).toBeUndefined();
    expect(await repo.listPoints('a')).toEqual([]);
    expect(await repo.listEvents('a')).toEqual([]);
    expect(await repo.listPoints('b')).toHaveLength(1);
  });

  it('deleteTripCascade is atomic: a failure deletes nothing', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    await repo.appendEvent(event(2, 'START'));
    db.tripEvents.hook('deleting', () => {
      throw new Error('disk failure');
    });
    await expect(repo.deleteTripCascade('t1')).rejects.toThrow();
    expect(await repo.getTrip('t1')).toBeDefined();
    expect(await repo.listPoints('t1')).toHaveLength(1);
  });

  it('keeps every row when the database is closed and reopened', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    await repo.appendEvent(event(2, 'START'));
    db.close();
    db = open();
    repo = new DexieTripRepository(db);
    expect(await repo.getTrip('t1')).toBeDefined();
    expect(await repo.listPoints('t1')).toHaveLength(1);
    expect(await repo.listEvents('t1')).toHaveLength(1);
  });

  it('migration pattern: a future schema version keeps existing v1 data (NFR-07)', async () => {
    await repo.create(trip());
    await repo.appendRawPoint(point(1));
    db.close();
    // A hypothetical v2 adds an index and back-fills a field without touching user data.
    const v2 = new Dexie('routetrack-test', { indexedDB: factory, IDBKeyRange });
    v2.version(1).stores(SCHEMA_V1);
    v2.version(2)
      .stores({ ...SCHEMA_V1, trips: `${SCHEMA_V1.trips}, name` })
      .upgrade(async (tx) => {
        await tx.table('trips').toCollection().modify({ migratedInTest: true });
      });
    const migrated = (await v2.table('trips').get('t1')) as
      (Trip & { migratedInTest?: boolean }) | undefined;
    expect(migrated?.name).toBe('Trip t1');
    expect(migrated?.migratedInTest).toBe(true);
    expect(await v2.table('gpsPoints').count()).toBe(1);
    v2.close();
    db = open(); // keep afterEach happy
  });
});
