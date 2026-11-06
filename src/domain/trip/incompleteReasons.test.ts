import { describe, expect, it } from 'vitest';
import type { TripEvent, TripEventType } from '../models/types';
import { incompleteReasons } from './incompleteReasons';

const ev = (type: TripEventType, metadata: TripEvent['metadata'] = null): TripEvent => ({
  id: type,
  tripId: 't',
  seq: 0,
  timestamp: 0,
  type,
  metadata,
});

const base = { isIncomplete: true, startLat: 21, endLat: 21 };

describe('incompleteReasons (review I5)', () => {
  it('returns nothing for a complete trip', () => {
    expect(incompleteReasons({ ...base, isIncomplete: false }, [ev('PAGE_HIDDEN')])).toEqual([]);
  });

  it('names each cause found in the events and the trip summary', () => {
    expect(
      incompleteReasons({ ...base, endLat: null }, [
        ev('START'),
        ev('PAGE_HIDDEN'),
        ev('PAGE_VISIBLE'),
        ev('GPS_GAP_BEGIN'),
        ev('GPS_GAP_END'),
        ev('GPS_ERROR', { code: 'PERMISSION_DENIED' }),
        ev('STORAGE_ERROR'),
      ]),
    ).toEqual(['HIDDEN', 'GPS_GAP', 'INTERRUPTED', 'STORAGE', 'NO_END_FIX']);
  });

  it('does not treat a non-fatal GPS error as an interruption', () => {
    expect(incompleteReasons(base, [ev('GPS_ERROR', { code: 'TIMEOUT' })])).toEqual(['OTHER']);
  });

  it('falls back to OTHER when the cause is not recorded', () => {
    expect(incompleteReasons(base, [ev('START'), ev('END')])).toEqual(['OTHER']);
  });

  it('with the replayed analysis, a large GPS gap and missing end fix are named without live events', () => {
    const analysis = { isIncomplete: true, start: { lat: 1, lng: 2 }, end: null, largeGapCount: 1 };
    expect(
      incompleteReasons({ ...base, isIncomplete: false }, [ev('START'), ev('END')], analysis),
    ).toEqual(['GPS_GAP', 'NO_END_FIX']);
  });

  it('the analysis decides completeness over a stale stored flag', () => {
    const analysis = {
      isIncomplete: false,
      start: { lat: 1, lng: 2 },
      end: { lat: 1, lng: 2 },
      largeGapCount: 0,
    };
    expect(incompleteReasons(base, [ev('PAGE_HIDDEN')], analysis)).toEqual([]);
  });
});
