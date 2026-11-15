/**
 * Import a .gpx track, and back up / restore the whole database (RT-404, RT-405).
 *
 * IndexedDB is the only copy of a trip: clearing site data or private browsing loses it, so the
 * backup button is first-class, not buried.
 */
import { useId, useRef, useState } from 'react';
import { TRANSPORT_MODE_LABELS } from '@/app/format';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { TRANSPORT_MODES, type TransportMode } from '@/domain/models/types';
import { useImportGpx, type ImportResult } from '@/hooks/useImportGpx';
import { useBackup, type RestoreResult } from '@/hooks/useTripExport';
import { useUiStore } from '@/stores/uiStore';

export function DataTransfer() {
  const gpxId = useId();
  const backupId = useId();
  const gpxRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const { importFile, busy: importing, error: importError, clearError } = useImportGpx();
  const { exportAll, restore, busy: backupBusy, error: backupError } = useBackup();
  const storedMode = useUiStore((s) => s.transportMode);
  const [mode, setMode] = useState<TransportMode>(storedMode);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const busy = importing || backupBusy;

  return (
    <section
      aria-label="Nhập và sao lưu dữ liệu"
      className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"
    >
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Nhập hành trình từ tệp GPX</h2>
        <p className="text-sm text-slate-600">
          Đọc tệp <code>.gpx</code> từ thiết bị hoặc ứng dụng khác. Hành trình nhập được đánh dấu
          riêng vì RouteTrack không trực tiếp đo nó.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center justify-between gap-2 text-sm font-semibold text-slate-900">
            Đi bằng
            <select
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
              value={mode}
              onChange={(e) => {
                setMode(e.currentTarget.value as TransportMode);
              }}
            >
              {TRANSPORT_MODES.map((m) => (
                <option key={m} value={m}>
                  {TRANSPORT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={gpxId} className="sr-only">
            Chọn tệp GPX
          </label>
          <input
            id={gpxId}
            ref={gpxRef}
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file === undefined) return;
              setImported(null);
              void importFile(file, mode).then(setImported);
            }}
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              clearError();
              gpxRef.current?.click();
            }}
          >
            {importing ? 'Đang nhập…' : 'Chọn tệp GPX…'}
          </Button>
        </div>
        {importError !== null && (
          <Notice tone="error" testId="import-error">
            {importError}
          </Notice>
        )}
        {imported !== null && (
          <Notice tone="info" testId="import-done">
            Đã nhập “{imported.name}” với {imported.pointCount} điểm
            {imported.skipped > 0 &&
              ` (bỏ qua ${String(imported.skipped)} điểm thiếu vị trí hoặc thời gian)`}
            .
          </Notice>
        )}
      </div>

      <hr className="border-slate-200" />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Sao lưu và khôi phục</h2>
        <p className="text-sm text-slate-600">
          Dữ liệu chỉ nằm trên thiết bị này. Xóa dữ liệu trình duyệt là mất hết — hãy tải bản sao
          lưu JSON định kỳ. Khôi phục không ghi đè hành trình đã có.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSavedCount(null);
              void exportAll().then(setSavedCount);
            }}
          >
            Tải bản sao lưu
          </Button>
          <label htmlFor={backupId} className="sr-only">
            Chọn tệp sao lưu JSON
          </label>
          <input
            id={backupId}
            ref={backupRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file === undefined) return;
              setRestored(null);
              void restore(file).then(setRestored);
            }}
          />
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              backupRef.current?.click();
            }}
          >
            {backupBusy ? 'Đang xử lý…' : 'Khôi phục từ tệp…'}
          </Button>
        </div>
        {backupError !== null && (
          <Notice tone="error" testId="backup-error">
            {backupError}
          </Notice>
        )}
        {savedCount !== null && (
          <Notice tone="info" testId="backup-done">
            Đã tải bản sao lưu gồm {savedCount} hành trình.
          </Notice>
        )}
        {restored !== null && (
          <Notice tone="info" testId="restore-done">
            Đã khôi phục {restored.added} hành trình
            {restored.skipped > 0 && `, bỏ qua ${String(restored.skipped)} hành trình đã có`}.
          </Notice>
        )}
      </div>
    </section>
  );
}
