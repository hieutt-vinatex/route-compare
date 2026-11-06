import { describe, expect, it } from 'vitest';
import type { GpsPoint } from '../models/types';
import { segmentsFromPoints } from './segments';

function point(seq: number, segmentId: number | null, accepted = segmentId !== null): GpsPoint {
  return {
    id: `p${seq}`,
    tripId: 't',
    sourceSeq: seq,
    sourceTimestamp: seq * 1000,
    recordedAt: seq * 1000,
    latitude: 21 + seq / 1000,
    longitude: 105,
    accuracyM: 5,
    speedMps: null,
    headingDeg: null,
    segmentId,
    accepted,
    rejectCode: accepted ? null : 'ACCURACY',
    derivedSpeedMps: null,
  };
}

describe('segmentsFromPoints', () => {
  it('splits by segment id, orders by sourceSeq and drops rejected points', () => {
    const points = [point(4, 2), point(1, 1), point(2, null), point(3, 1), point(5, 2)];
    const segments = segmentsFromPoints(points);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.map((p) => p.lat)).toEqual([21.001, 21.003]);
    expect(segments[1]?.map((p) => p.lat)).toEqual([21.004, 21.005]);
  });

  it('returns no segments when nothing was accepted', () => {
    expect(segmentsFromPoints([point(1, null)])).toEqual([]);
  });
});
