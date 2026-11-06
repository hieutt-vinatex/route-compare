/**
 * In-memory TripRepository — the test double behind the controller harness (data is LOST on
 * reload). Same port and rules as DexieTripRepository. Values are cloned on write/read to mimic
 * persistence semantics (no shared references).
 */
import type { GpsPoint, PointProcessingResult, Trip, TripEvent } from '@/domain/models/types';
import type { TripRepository } from '@/domain/ports';
import { TripNotEditableError } from '@/domain/trip/errors';
import { normalizeTripName } from '@/domain/trip/tripName';

export class InMemoryTripRepository implements TripRepository {
  private readonly trips = new Map<string, Trip>();
  private readonly points = new Map<string, GpsPoint>();
  private readonly events = new Map<string, TripEvent>();

  create(trip: Trip): Promise<void> {
    if (this.trips.has(trip.id)) return Promise.reject(new Error(`Trip ${trip.id} already exists`));
    this.trips.set(trip.id, structuredClone(trip));
    return Promise.resolve();
  }

  updateTrip(trip: Trip): Promise<void> {
    const existing = this.trips.get(trip.id);
    if (existing === undefined) return Promise.reject(new Error(`Trip ${trip.id} not found`));
    if (existing.status === 'COMPLETED' && trip.status !== 'COMPLETED') {
      return Promise.reject(new Error(`Trip ${trip.id} is already completed`));
    }
    this.trips.set(trip.id, structuredClone(trip));
    return Promise.resolve();
  }

  renameTrip(id: string, name: string, updatedAt: number): Promise<void> {
    const normalized = normalizeTripName(name);
    if (normalized === null) {
      return Promise.reject(new RangeError('Trip name must be 1–120 characters'));
    }
    const existing = this.trips.get(id);
    if (existing?.status !== 'COMPLETED') return Promise.reject(new TripNotEditableError(id));
    this.trips.set(id, { ...existing, name: normalized, updatedAt });
    return Promise.resolve();
  }

  getTrip(id: string): Promise<Trip | undefined> {
    const trip = this.trips.get(id);
    return Promise.resolve(trip === undefined ? undefined : structuredClone(trip));
  }

  listTrips(): Promise<Trip[]> {
    const list = [...this.trips.values()].sort((a, b) => b.startedAt - a.startedAt);
    return Promise.resolve(list.map((t) => structuredClone(t)));
  }

  listActiveTrips(): Promise<Trip[]> {
    return this.listTrips().then((trips) => trips.filter((t) => t.status !== 'COMPLETED'));
  }

  deleteTripCascade(id: string): Promise<void> {
    this.trips.delete(id);
    for (const [key, point] of this.points) if (point.tripId === id) this.points.delete(key);
    for (const [key, event] of this.events) if (event.tripId === id) this.events.delete(key);
    return Promise.resolve();
  }

  appendRawPoint(point: GpsPoint): Promise<void> {
    if (!this.trips.has(point.tripId)) {
      return Promise.reject(new Error(`Trip ${point.tripId} not found`));
    }
    if (this.points.has(point.id)) return Promise.resolve(); // idempotent
    for (const p of this.points.values()) {
      if (p.tripId === point.tripId && p.sourceSeq === point.sourceSeq) {
        return Promise.reject(new Error(`Duplicate sourceSeq ${point.sourceSeq}`));
      }
    }
    this.points.set(point.id, structuredClone(point));
    return Promise.resolve();
  }

  recordProcessingResult(pointId: string, result: PointProcessingResult): Promise<void> {
    const point = this.points.get(pointId);
    if (point === undefined) return Promise.reject(new Error(`Point ${pointId} not found`));
    this.points.set(pointId, { ...point, ...result });
    return Promise.resolve();
  }

  appendEvent(event: TripEvent): Promise<void> {
    if (!this.trips.has(event.tripId)) {
      return Promise.reject(new Error(`Trip ${event.tripId} not found`));
    }
    this.events.set(event.id, structuredClone(event));
    return Promise.resolve();
  }

  listPoints(tripId: string): Promise<GpsPoint[]> {
    const list = [...this.points.values()]
      .filter((p) => p.tripId === tripId)
      .sort((a, b) => a.sourceSeq - b.sourceSeq);
    return Promise.resolve(list.map((p) => structuredClone(p)));
  }

  listEvents(tripId: string): Promise<TripEvent[]> {
    const list = [...this.events.values()]
      .filter((e) => e.tripId === tripId)
      .sort((a, b) => a.seq - b.seq);
    return Promise.resolve(list.map((e) => structuredClone(e)));
  }
}
