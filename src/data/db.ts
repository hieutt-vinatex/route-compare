/**
 * IndexedDB schema (docs/04 §6) — the ONLY Dexie entry point. Components never import this file
 * (ESLint rule); everything goes through src/data/repositories.
 *
 * Migration rule: never edit a published version. Add `this.version(n).stores(...).upgrade(...)`
 * with a test that opens v(n-1) data and checks nothing is lost (NFR-07).
 */
import Dexie, { type DexieOptions, type EntityTable } from 'dexie';
import type { GpsPoint, Trip, TripEvent } from '@/domain/models/types';

export const DB_NAME = 'routetrack';

/** Multi-tab lease row used when the Web Locks API is unavailable (RT-206). */
export interface RecorderLeaseRow {
  readonly name: string;
  readonly ownerId: string;
  readonly expiresAt: number;
}

/** Route groups arrive in M4; the table exists from v1 so M4 needs no schema bump. */
export interface RouteGroupRow {
  readonly id: string;
  readonly name: string;
}

export const SCHEMA_V1 = {
  trips: 'id, startedAt, status, transportMode, routeGroupId, updatedAt',
  // D1: one raw sample per (trip, sequence number).
  gpsPoints: 'id, tripId, &[tripId+sourceSeq], [tripId+sourceTimestamp]',
  // D2: `seq` shares the per-trip counter with gpsPoints.sourceSeq (replay order).
  tripEvents: 'id, tripId, [tripId+seq], [tripId+timestamp], type',
  routeGroups: 'id, name',
  recorderLease: 'name',
} as const;

export class RouteTrackDb extends Dexie {
  declare readonly trips: EntityTable<Trip, 'id'>;
  declare readonly gpsPoints: EntityTable<GpsPoint, 'id'>;
  declare readonly tripEvents: EntityTable<TripEvent, 'id'>;
  declare readonly routeGroups: EntityTable<RouteGroupRow, 'id'>;
  declare readonly recorderLease: EntityTable<RecorderLeaseRow, 'name'>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores(SCHEMA_V1);
  }
}
