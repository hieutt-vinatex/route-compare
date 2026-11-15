/**
 * Export one trip (GPX / CSV / JSON) and the whole database (JSON backup), and restore a backup
 * (RT-404, RT-405). Components never touch storage or the DOM directly: the repository port and
 * the download adapter do.
 */
import { useCallback, useState } from 'react';
import { downloadText } from '@/adapters/download';
import { BackupParseError, parseBackup } from '@/domain/export/parseBackup';
import {
  exportFileName,
  toBackupJson,
  toCsv,
  toGpx,
  type TripBundle,
} from '@/domain/export/serialize';
import type { Trip } from '@/domain/models/types';
import type { TripRepository } from '@/domain/ports';
import { useServices } from './useServices';

export type ExportFormat = 'gpx' | 'csv' | 'json';

const MIME: Readonly<Record<ExportFormat, string>> = {
  gpx: 'application/gpx+xml',
  csv: 'text/csv',
  json: 'application/json',
};

async function bundleOf(repository: TripRepository, trip: Trip): Promise<TripBundle> {
  const [points, events] = await Promise.all([
    repository.listPoints(trip.id),
    repository.listEvents(trip.id),
  ]);
  return { trip, points, events };
}

export function useTripExport(): {
  exportTrip: (trip: Trip, format: ExportFormat) => Promise<void>;
  busy: boolean;
  error: string | null;
} {
  const { repository, config } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportTrip = useCallback(
    async (trip: Trip, format: ExportFormat) => {
      setBusy(true);
      setError(null);
      try {
        const bundle = await bundleOf(repository, trip);
        const text =
          format === 'gpx'
            ? toGpx(bundle, config)
            : format === 'csv'
              ? toCsv(bundle)
              : toBackupJson([bundle], Date.now());
        downloadText(exportFileName(trip, format), MIME[format], text);
      } catch {
        setError('Không xuất được dữ liệu hành trình.');
      } finally {
        setBusy(false);
      }
    },
    [repository, config],
  );

  return { exportTrip, busy, error };
}

export interface RestoreResult {
  readonly added: number;
  /** Trips already present (same id): a restore never silently overwrites existing data. */
  readonly skipped: number;
}

export function useBackup(): {
  exportAll: () => Promise<number>;
  restore: (file: File) => Promise<RestoreResult | null>;
  busy: boolean;
  error: string | null;
} {
  const { repository, clock } = useServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportAll = useCallback(async (): Promise<number> => {
    setBusy(true);
    setError(null);
    try {
      const trips = await repository.listTrips();
      const bundles = await Promise.all(trips.map((trip) => bundleOf(repository, trip)));
      const at = clock.now();
      downloadText(
        `routetrack-backup-${new Date(at).toISOString().slice(0, 10)}.json`,
        MIME.json,
        toBackupJson(bundles, at),
      );
      return trips.length;
    } catch {
      setError('Không tạo được bản sao lưu.');
      return 0;
    } finally {
      setBusy(false);
    }
  }, [repository, clock]);

  const restore = useCallback(
    async (file: File): Promise<RestoreResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const bundles = parseBackup(await file.text());
        const existing = new Set((await repository.listTrips()).map((t) => t.id));
        let added = 0;
        for (const bundle of bundles) {
          if (existing.has(bundle.trip.id)) continue;
          await repository.importTrip(bundle.trip, bundle.points, bundle.events);
          added += 1;
        }
        return { added, skipped: bundles.length - added };
      } catch (cause) {
        setError(
          cause instanceof BackupParseError
            ? cause.message
            : 'Không khôi phục được bản sao lưu. Hãy kiểm tra tệp.',
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [repository],
  );

  return { exportAll, restore, busy, error };
}
