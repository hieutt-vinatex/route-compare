/**
 * GPX reader (RT-404). Fixtures mirror what free background loggers actually write, because the
 * whole point of the feature is reading their files when the screen was off.
 */
import { describe, expect, it } from 'vitest';
import { GpxParseError, HDOP_TO_ACCURACY_M, parseGpx } from './gpx';

const header =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="GPSLogger" xmlns="http://www.topografix.com/GPX/1/1">';

function trkpt(lat: number, lon: number, time: string, inner = ''): string {
  return `<trkpt lat="${lat}" lon="${lon}"><time>${time}</time>${inner}</trkpt>`;
}

describe('parseGpx', () => {
  it('reads position and time from a logger track, in time order', () => {
    const gpx = `${header}<trk><name>Đi làm</name><trkseg>
      ${trkpt(20.3, 105.75, '2026-11-12T10:42:19Z')}
      ${trkpt(20.3001, 105.75, '2026-11-12T10:42:49Z')}
    </trkseg></trk></gpx>`;
    const parsed = parseGpx(gpx);

    expect(parsed.name).toBe('Đi làm');
    expect(parsed.skipped).toBe(0);
    expect(parsed.fixes).toHaveLength(2);
    expect(parsed.fixes[0]).toMatchObject({
      lat: 20.3,
      lng: 105.75,
      timestamp: Date.parse('2026-11-12T10:42:19Z'),
      accuracyM: null,
      speedMps: null,
      segmentIndex: 0,
    });
    expect(parsed.fixes[1]?.timestamp).toBeGreaterThan(parsed.fixes[0]?.timestamp ?? 0);
  });

  it('keeps each <trkseg> apart, so a logger restart is never bridged', () => {
    const gpx = `${header}<trk><trkseg>
      ${trkpt(20.3, 105.75, '2026-11-12T10:00:00Z')}
    </trkseg><trkseg>
      ${trkpt(20.4, 105.75, '2026-11-12T10:30:00Z')}
    </trkseg></trk></gpx>`;
    expect(parseGpx(gpx).fixes.map((f) => f.segmentIndex)).toEqual([0, 1]);
  });

  it('prefers a stated accuracy and falls back to HDOP as an estimate', () => {
    const gpx = `${header}<trk><trkseg>
      ${trkpt(20.3, 105.75, '2026-11-12T10:00:00Z', '<extensions><gl:accuracy xmlns:gl="http://gpslogger.app/v1">8.5</gl:accuracy></extensions>')}
      ${trkpt(20.3, 105.75, '2026-11-12T10:00:10Z', '<hdop>1.4</hdop>')}
      ${trkpt(20.3, 105.75, '2026-11-12T10:00:20Z', '<hdop>0</hdop>')}
    </trkseg></trk></gpx>`;
    const [a, b, c] = parseGpx(gpx).fixes;
    expect(a?.accuracyM).toBe(8.5);
    expect(b?.accuracyM).toBeCloseTo(1.4 * HDOP_TO_ACCURACY_M, 6);
    expect(c?.accuracyM).toBeNull(); // 0 is not a usable accuracy (docs/05 §3.1)
  });

  it('skips points without a usable position or time instead of inventing one', () => {
    const gpx = `${header}<trk><trkseg>
      ${trkpt(20.3, 105.75, '2026-11-12T10:00:00Z')}
      <trkpt lat="20.3" lon="105.75"></trkpt>
      <trkpt lat="abc" lon="105.75"><time>2026-11-12T10:00:10Z</time></trkpt>
      ${trkpt(20.3, 105.75, 'not-a-date')}
    </trkseg></trk></gpx>`;
    const parsed = parseGpx(gpx);
    expect(parsed.fixes).toHaveLength(1);
    expect(parsed.skipped).toBe(3);
  });

  it('reads a namespace-prefixed GPX and a <metadata> name', () => {
    const gpx =
      '<?xml version="1.0"?><g:gpx version="1.1" xmlns:g="http://www.topografix.com/GPX/1/1">' +
      '<g:metadata><g:name>Chuyến tối</g:name></g:metadata><g:trk><g:trkseg>' +
      '<g:trkpt lat="20.3" lon="105.75"><g:time>2026-11-12T10:00:00Z</g:time></g:trkpt>' +
      '</g:trkseg></g:trk></g:gpx>';
    const parsed = parseGpx(gpx);
    expect(parsed.name).toBe('Chuyến tối');
    expect(parsed.fixes).toHaveLength(1);
  });

  it.each([
    ['không phải XML', 'hello world'],
    ['XML nhưng không phải GPX', '<?xml version="1.0"?><kml><Placemark/></kml>'],
    ['GPX rỗng', `${header}<trk><trkseg></trkseg></trk></gpx>`],
    ['GPX không có <time>', `${header}<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`],
  ])('refuses %s with a message, never a half-read track', (_case, xml) => {
    expect(() => parseGpx(xml)).toThrow(GpxParseError);
  });
});
