/**
 * TripRepository over IndexedDB (Dexie). Every write that must be consistent runs in one
 * transaction (docs/04 §7). Errors are never swallowed: callers (TrackingController) turn a
 * rejected write into a visible storage error.
 */
import Dexie from 'dexie';
import type { GpsPoint, PointProcessingResult, Trip, TripEvent } from '@/domain/models/types';
import type { TripRepository } from '@/domain/ports';
import { TripNotEditableError } from '@/domain/trip/errors';
import { normalizeTripName } from '@/domain/trip/tripName';
import type { RouteTrackDb } from '../db';

export class DexieTripRepository implements TripRepository {
  private readonly db: RouteTrackDb;

  constructor(db: RouteTrackDb) {
    this.db = db;
  }

  async create(trip: Trip): Promise<void> {
    await this.db.trips.add(trip); // rejects with ConstraintError for an existing id
  }

  async updateTrip(trip: Trip): Promise<void> {
    await this.db.transaction('rw', this.db.trips, async () => {
      const existing = await this.db.trips.get(trip.id);
      if (existing === undefined) throw new Error(`Trip ${trip.id} not found`);
      // A finished summary is final: late writers (timed-out saves, other tabs) cannot undo it.
      if (existing.status === 'COMPLETED' && trip.status !== 'COMPLETED') {
        throw new Error(`Trip ${trip.id} is already completed`);
      }
      await this.db.trips.put(trip);
    });
  }

  async renameTrip(id: string, name: string, updatedAt: number): Promise<void> {
    const normalized = normalizeTripName(name);
    if (normalized === null) throw new RangeError('Trip name must be 1–120 characters');
    await this.db.transaction('rw', this.db.trips, async () => {
      const existing = await this.db.trips.get(id);
      if (existing?.status !== 'COMPLETED') throw new TripNotEditableError(id);
      // A field update, not a row overwrite: nothing else the row holds can be lost.
      await this.db.trips.update(id, { name: normalized, updatedAt });
    });
  }

  getTrip(id: string): Promise<Trip | undefined> {
    return this.db.trips.get(id);
  }

  listTrips(): Promise<Trip[]> {
    return this.db.trips.orderBy('startedAt').reverse().toArray();
  }

  listActiveTrips(): Promise<Trip[]> {
    return this.db.trips.where('status').noneOf(['COMPLETED']).toArray();
  }

  async deleteTripCascade(id: string): Promise<void> {
    const { trips, gpsPoints, tripEvents } = this.db;
    await this.db.transaction('rw', [trips, gpsPoints, tripEvents], async () => {
      await gpsPoints.where('tripId').equals(id).delete();
      await tripEvents.where('tripId').equals(id).delete();
      await trips.delete(id);
    });
  }

  async appendRawPoint(point: GpsPoint): Promise<void> {
    const { trips, gpsPoints } = this.db;
    await this.db.transaction('rw', [trips, gpsPoints], async () => {
      await this.assertTripExists(point.tripId);
      if ((await gpsPoints.get(point.id)) !== undefined) return; // idempotent retry
      await gpsPoints.add(point); // unique [tripId+sourceSeq]
    });
  }

  async recordProcessingResult(pointId: string, result: PointProcessingResult): Promise<void> {
    const updated = await this.db.gpsPoints.update(pointId, { ...result });
    if (updated === 0) throw new Error(`Point ${pointId} not found`);
  }

  async appendEvent(event: TripEvent): Promise<void> {
    const { trips, tripEvents } = this.db;
    await this.db.transaction('rw', [trips, tripEvents], async () => {
      await this.assertTripExists(event.tripId);
      await tripEvents.put(event);
    });
  }

  listPoints(tripId: string): Promise<GpsPoint[]> {
    return this.db.gpsPoints
      .where('[tripId+sourceSeq]')
      .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
      .toArray();
  }

  listEvents(tripId: string): Promise<TripEvent[]> {
    return this.db.tripEvents
      .where('[tripId+seq]')
      .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
      .toArray();
  }

  private async assertTripExists(tripId: string): Promise<void> {
    if ((await this.db.trips.get(tripId)) === undefined) {
      throw new Error(`Trip ${tripId} not found`);
    }
  }
}
