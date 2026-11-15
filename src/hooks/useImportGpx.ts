/**
 * Import a GPX file as a finished trip (RT-404). Imported trips carry `importedFrom` everywhere
 * they are shown — they are not RouteTrack measurements.
 */
import { useCallback, useState } from 'react';
import { GpxParseError, parseGpx } from '@/adapters/import/gpx';
import { buildImportedTrip } from '@/domain/import/importedTrip';
import type { TransportMode } from '@/domain/models/types';
import { useServices } from './useServices';

/** Larger files are refused: parsing happens on the UI thread (shortcut: move to a Worker if hit). */
export const MAX_GPX_BYTES = 20 * 1024 * 1024;

export interface ImportResult {
  readonly tripId: string;
  readonly name: string;
  readonly pointCount: number;
  /** `<trkpt>` entries the file had but RouteTrack could not use (no position or no time). */
  readonly skipped: number;
}

export function useImportGpx(): {
  importFile: (file: File, transportMode: TransportMode) => Promise<ImportResult | null>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
} {
  const { repository, clock, ids, config } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = useCallback(
    async (file: File, transportMode: TransportMode): Promise<ImportResult | null> => {
      setBusy(true);
      setError(null);
      try {
        if (file.size > MAX_GPX_BYTES) {
          throw new GpxParseError(
            `Tệp quá lớn (tối đa ${String(Math.round(MAX_GPX_BYTES / 1024 / 1024))} MB).`,
          );
        }
        const parsed = parseGpx(await file.text());
        const data = buildImportedTrip({
          fixes: parsed.fixes,
          name: parsed.name ?? fileBaseName(file.name),
          transportMode,
          source: 'GPX',
          ids: () => ids.next(),
          now: clock.now(),
          config,
        });
        await repository.importTrip(data.trip, data.points, data.events);
        return {
          tripId: data.trip.id,
          name: data.trip.name,
          pointCount: data.points.length,
          skipped: parsed.skipped,
        };
      } catch (cause) {
        setError(
          cause instanceof GpxParseError || cause instanceof RangeError
            ? cause.message
            : 'Không nhập được tệp. Hãy thử lại hoặc chọn tệp GPX khác.',
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [repository, clock, ids, config],
  );

  return {
    importFile,
    busy,
    error,
    clearError: useCallback(() => {
      setError(null);
    }, []),
  };
}

function fileBaseName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').trim();
  return base === '' ? 'Hành trình nhập' : base.slice(0, 80);
}
