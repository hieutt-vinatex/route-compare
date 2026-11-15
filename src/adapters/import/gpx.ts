/**
 * GPX 1.1 reader (RT-404). Lives in adapters because it uses the browser's DOMParser;
 * `src/domain/import` turns the result into a Trip without touching the DOM.
 *
 * Only what RouteTrack can defend is read: position, time, and an accuracy when the file states
 * one. Elevation and heading are ignored — nothing in the analytics uses them.
 */

import type { ImportedFix } from '@/domain/import/importedTrip';

export interface ParsedGpx {
  /** `<trk><name>` or `<metadata><name>`, trimmed; null when the file names nothing. */
  readonly name: string | null;
  readonly fixes: readonly ImportedFix[];
  /** `<trkpt>` elements skipped because they had no usable position or time. */
  readonly skipped: number;
}

export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpxParseError';
  }
}

/**
 * HDOP is a unitless geometry factor, not metres. When a file gives no accuracy at all, HDOP ×
 * this is the usual field estimate (HDOP × UERE) — an ESTIMATE, surfaced as such in the UI.
 */
export const HDOP_TO_ACCURACY_M = 5;

/** Reads a `.gpx` file's text. Throws GpxParseError when it is not GPX or has no timed point. */
export function parseGpx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) {
    throw new GpxParseError('Tệp không phải XML hợp lệ.');
  }
  const root = doc.documentElement;
  // localName ignores the GPX namespace prefix, which varies between loggers.
  if (root.localName !== 'gpx') {
    throw new GpxParseError('Tệp không phải GPX (thiếu phần tử <gpx>).');
  }

  const fixes: ImportedFix[] = [];
  let skipped = 0;
  const segments = Array.from(root.getElementsByTagName('*')).filter(
    (el) => el.localName === 'trkseg',
  );
  for (const [segmentIndex, seg] of segments.entries()) {
    for (const pt of Array.from(seg.children).filter((el) => el.localName === 'trkpt')) {
      const fix = toFix(pt, segmentIndex);
      if (fix === null) skipped += 1;
      else fixes.push(fix);
    }
  }
  if (fixes.length === 0) {
    throw new GpxParseError('GPX không có điểm nào kèm thời gian (<trkpt> + <time>).');
  }
  // Loggers write points in order, but a concatenated file may not be: analytics needs order.
  const sorted = [...fixes].sort((a, b) => a.timestamp - b.timestamp);
  return { name: trackName(root), fixes: sorted, skipped };
}

function toFix(pt: Element, segmentIndex: number): ImportedFix | null {
  const lat = Number(pt.getAttribute('lat'));
  const lng = Number(pt.getAttribute('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const time = Date.parse(childText(pt, 'time') ?? '');
  if (!Number.isFinite(time)) return null;

  return {
    lat,
    lng,
    timestamp: time,
    accuracyM: accuracyOf(pt),
    speedMps: positiveNumber(childText(pt, 'speed')),
    segmentIndex,
  };
}

/** A stated accuracy wins; HDOP is only a fallback estimate. */
function accuracyOf(pt: Element): number | null {
  const stated = positiveNumber(descendantText(pt, 'accuracy'));
  if (stated !== null) return stated;
  const hdop = positiveNumber(childText(pt, 'hdop'));
  return hdop === null ? null : hdop * HDOP_TO_ACCURACY_M;
}

function trackName(root: Element): string | null {
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if (el.localName !== 'name') continue;
    const parent = el.parentElement?.localName;
    if (parent !== 'trk' && parent !== 'metadata') continue;
    // Element.textContent is never null per DOM spec (only Document/DocumentType are).
    const text = el.textContent.trim();
    if (text !== '') return text;
  }
  return null;
}

function childText(parent: Element, localName: string): string | null {
  for (const el of Array.from(parent.children)) {
    if (el.localName === localName) return el.textContent;
  }
  return null;
}

/** Accuracy is usually nested in `<extensions>`, under a vendor prefix. */
function descendantText(parent: Element, localName: string): string | null {
  for (const el of Array.from(parent.getElementsByTagName('*'))) {
    if (el.localName === localName) return el.textContent;
  }
  return null;
}

function positiveNumber(text: string | null): number | null {
  if (text === null) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}
