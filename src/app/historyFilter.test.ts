// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/models/types';
import { createTrip } from '@/domain/trip/tripFactory';
import {
  DEFAULT_HISTORY_FILTER,
  filterFromParams,
  filterToParams,
  filterTrips,
  isFilterActive,
  normalizeSearch,
  type HistoryFilter,
} from './historyFilter';

const TZ = 'Asia/Ho_Chi_Minh'; // UTC+7, no DST
const at = (iso: string): number => Date.parse(iso);

function trip(id: string, name: string, startedAt: number, patch: Partial<Trip> = {}): Trip {
  return {
    ...createTrip({ id, name, transportMode: 'MOTORBIKE', startedAt }),
    status: 'COMPLETED',
    ...patch,
  };
}

const trips = [
  trip('a', 'Hà Nội đi làm', at('2026-11-05T01:00:00Z')),
  // 23:30 local on 5/11
  trip('b', 'Về nhà qua Đường Láng', at('2026-11-05T16:30:00Z'), { transportMode: 'WALK' }),
  // 00:30 local on 6/11
  trip('c', 'Chợ cuối tuần', at('2026-11-05T17:30:00Z'), { isIncomplete: true }),
  trip('d', 'Đang ghi', at('2026-11-06T02:00:00Z'), { status: 'RECORDING' }),
];
const ids = (filter: Partial<HistoryFilter>) =>
  filterTrips(trips, { ...DEFAULT_HISTORY_FILTER, ...filter }, TZ).map((t) => t.id);

describe('normalizeSearch', () => {
  it('ignores case, Vietnamese diacritics, đ and extra spaces', () => {
    expect(normalizeSearch('  Hà   NỘI  Đường ')).toBe('ha noi duong');
  });
});

describe('filterTrips (FR-09)', () => {
  it('lists newest first with the default filter', () => {
    expect(ids({})).toEqual(['d', 'c', 'b', 'a']);
  });

  it('“ha noi” finds “Hà Nội đi làm”; every word must match, in any order', () => {
    expect(ids({ q: 'ha noi' })).toEqual(['a']);
    expect(ids({ q: 'lang duong' })).toEqual(['b']);
    expect(ids({ q: 'ha noi lang' })).toEqual([]);
  });

  it('filters by transport mode', () => {
    expect(ids({ mode: 'WALK' })).toEqual(['b']);
  });

  it('from/to are inclusive local days (23:30 local stays on its own day)', () => {
    expect(ids({ from: '2026-11-05', to: '2026-11-05' })).toEqual(['b', 'a']);
    expect(ids({ from: '2026-11-06' })).toEqual(['d', 'c']);
    expect(ids({ to: '2026-11-05' })).toEqual(['b', 'a']);
  });

  it('filters by status: complete, incomplete, unfinished', () => {
    expect(ids({ status: 'COMPLETE' })).toEqual(['b', 'a']);
    expect(ids({ status: 'INCOMPLETE' })).toEqual(['c']);
    expect(ids({ status: 'UNFINISHED' })).toEqual(['d']);
  });
});

describe('URL query ⇄ filter (Q1)', () => {
  it('round-trips and omits defaults', () => {
    const filter: HistoryFilter = {
      q: 'hà nội',
      mode: 'CAR',
      from: '2026-11-01',
      to: '2026-11-30',
      status: 'INCOMPLETE',
    };
    expect(filterFromParams(filterToParams(filter))).toEqual(filter);
    expect(filterToParams(DEFAULT_HISTORY_FILTER).toString()).toBe('');
  });

  it('falls back to “all” for unknown or malformed values', () => {
    const params = new URLSearchParams('mode=PLANE&status=x&from=5/11/2026&to=2026-13-40');
    expect(filterFromParams(params)).toEqual(DEFAULT_HISTORY_FILTER);
  });

  it('knows when a filter is active', () => {
    expect(isFilterActive(DEFAULT_HISTORY_FILTER)).toBe(false);
    expect(isFilterActive({ ...DEFAULT_HISTORY_FILTER, q: '  ' })).toBe(false);
    expect(isFilterActive({ ...DEFAULT_HISTORY_FILTER, mode: 'WALK' })).toBe(true);
  });
});
