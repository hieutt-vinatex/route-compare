/**
 * History search and filters (FR-09, docs/06 §5). Pure: the page keeps the filter in the URL
 * query (Q1) so it survives back/refresh; nothing is persisted.
 */
import { TRANSPORT_MODES, type TransportMode, type Trip } from '@/domain/models/types';

export const HISTORY_STATUSES = ['ALL', 'COMPLETE', 'INCOMPLETE', 'UNFINISHED'] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export interface HistoryFilter {
  readonly q: string;
  readonly mode: TransportMode | 'ALL';
  /** Inclusive local day `yyyy-mm-dd`, or null. */
  readonly from: string | null;
  readonly to: string | null;
  readonly status: HistoryStatus;
}

export const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  q: '',
  mode: 'ALL',
  from: null,
  to: null,
  status: 'ALL',
};

/** Case-, diacritics- and spacing-insensitive form (Q4): “Hà  Nội” → “ha noi”. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Newest first; every query word must appear in the name (any order). */
export function filterTrips(
  trips: readonly Trip[],
  filter: HistoryFilter,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Trip[] {
  const words = normalizeSearch(filter.q).split(' ').filter(Boolean);
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return trips
    .filter((trip) => {
      if (filter.mode !== 'ALL' && trip.transportMode !== filter.mode) return false;
      if (!matchesStatus(trip, filter.status)) return false;
      if (filter.from !== null || filter.to !== null) {
        const day = localDay.format(trip.startedAt); // en-CA → yyyy-mm-dd
        if (filter.from !== null && day < filter.from) return false;
        if (filter.to !== null && day > filter.to) return false;
      }
      if (words.length > 0) {
        const name = normalizeSearch(trip.name);
        if (!words.every((w) => name.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

function matchesStatus(trip: Trip, status: HistoryStatus): boolean {
  switch (status) {
    case 'ALL':
      return true;
    case 'COMPLETE':
      return trip.status === 'COMPLETED' && !trip.isIncomplete;
    case 'INCOMPLETE':
      return trip.status === 'COMPLETED' && trip.isIncomplete;
    case 'UNFINISHED':
      return trip.status !== 'COMPLETED';
  }
}

export function isFilterActive(filter: HistoryFilter): boolean {
  return (
    filter.q.trim() !== '' ||
    filter.mode !== 'ALL' ||
    filter.from !== null ||
    filter.to !== null ||
    filter.status !== 'ALL'
  );
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDay(value: string | null): string | null {
  if (value === null) return null;
  const m = DAY.exec(value);
  if (m === null) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? value : null;
}

export function filterFromParams(params: URLSearchParams): HistoryFilter {
  const mode = params.get('mode');
  const status = params.get('status');
  return {
    q: params.get('q') ?? '',
    mode: TRANSPORT_MODES.find((m) => m === mode) ?? 'ALL',
    from: validDay(params.get('from')),
    to: validDay(params.get('to')),
    status: HISTORY_STATUSES.find((s) => s === status) ?? 'ALL',
  };
}

/** Only non-default values, so the plain list has a clean URL. */
export function filterToParams(filter: HistoryFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q !== '') params.set('q', filter.q);
  if (filter.mode !== 'ALL') params.set('mode', filter.mode);
  if (filter.from !== null) params.set('from', filter.from);
  if (filter.to !== null) params.set('to', filter.to);
  if (filter.status !== 'ALL') params.set('status', filter.status);
  return params;
}
