/**
 * Compare 2–4 trips that share an origin, a destination and a transport mode (FR-11, RT-402).
 *
 * What this screen must never imply: that two trips with the same endpoints took the same road,
 * or that a difference between two measured distances is a difference between routes. Both are
 * stated on screen, and a low-coverage trip is flagged in its own row.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatDateTime, formatDistance, formatDuration, formatPercent } from '@/app/format';
import { QUALITY_LABELS, TRANSPORT_MODE_LABELS } from '@/app/format';
import { LazyTrackMap } from '@/components/map/LazyTrackMap';
import { qualityTone } from '@/components/trip/quality';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  compareTrips,
  MAX_COMPARED_TRIPS,
  MIN_COMPARED_TRIPS,
  MIN_TRIPS_FOR_DISTRIBUTION,
} from '@/domain/compare/compare';
import { groupTrips } from '@/domain/compare/grouping';
import type { LatLng } from '@/domain/models/types';
import { useComparedTrips } from '@/hooks/useCompare';
import { useServices } from '@/hooks/useServices';
import { useTripList } from '@/hooks/useTrips';

/** One colour per compared trip; also used for the map overlay. */
const COLORS = ['#0f766e', '#b45309', '#6d28d9', '#be123c'] as const;

export function ComparePage() {
  const { config } = useServices();
  const trips = useTripList();
  const [groupIndex, setGroupIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const groups = useMemo(
    () => (trips.status === 'ready' ? groupTrips(trips.data, config) : []),
    [trips, config],
  );
  const group = groups[groupIndex] ?? groups[0];
  const candidates = useMemo(() => group?.trips ?? [], [group]);

  const selected = useMemo(
    () => candidates.filter((t) => selectedIds.includes(t.id)).slice(0, MAX_COMPARED_TRIPS),
    [candidates, selectedIds],
  );
  const analysis = useComparedTrips(selected);
  const data = useMemo(() => (analysis.status === 'ready' ? analysis.data : []), [analysis]);
  const loading = analysis.status === 'loading' && selected.length > 0;
  const error = analysis.status === 'error';
  const comparison = useMemo(
    () => compareTrips(data, config.quality.goodCoveragePct),
    [data, config],
  );

  const colorOf = (tripId: string): string =>
    COLORS[comparison.rows.findIndex((r) => r.tripId === tripId) % COLORS.length] ?? COLORS[0];

  // One flat list of polylines; each keeps its trip's colour so the overlay stays readable.
  const { segments, segmentColors } = useMemo(() => {
    const out: (readonly LatLng[])[] = [];
    const colors: string[] = [];
    for (const item of data) {
      const color = colorOf(item.trip.id);
      for (const segment of item.metrics.segments) {
        out.push(segment);
        colors.push(color);
      }
    }
    return { segments: out, segmentColors: colors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, comparison.rows]);

  const toggle = (id: string): void => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_COMPARED_TRIPS
          ? current
          : [...current, id],
    );
  };

  if (trips.status === 'loading') {
    return <Shell>{<p className="text-sm text-slate-600">Đang tải…</p>}</Shell>;
  }
  if (groups.length === 0) {
    return (
      <Shell>
        <EmptyState
          title="Chưa có nhóm hành trình nào để so sánh"
          description="Cần ít nhất hai hành trình đã kết thúc, cùng phương tiện, có điểm đầu và điểm cuối cách nhau không quá 150 m. Hành trình thiếu vị trí GPS lúc bắt đầu hoặc kết thúc không thể ghép nhóm."
          action={
            <Link to="/history" className={buttonClass('secondary')}>
              Xem lịch sử
            </Link>
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Notice tone="info">
        Cùng điểm đi và điểm đến <strong>không</strong> có nghĩa là cùng một con đường. Chênh lệch
        quãng đường là chênh lệch giữa những gì GPS đo được, không phải giữa hai tuyến đường.
      </Notice>

      {groups.length > 1 && (
        <label className="block text-sm font-semibold text-slate-900">
          Nhóm tuyến
          <select
            className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
            value={groupIndex}
            onChange={(e) => {
              setGroupIndex(Number(e.currentTarget.value));
              setSelectedIds([]);
            }}
          >
            {groups.map((g, i) => (
              <option key={i} value={i}>
                {TRANSPORT_MODE_LABELS[g.trips[0]?.transportMode ?? 'CAR']} ·{' '}
                {String(g.trips.length)} hành trình · từ{' '}
                {formatDateTime(g.trips.at(-1)?.startedAt ?? 0)}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900">
          Chọn {String(MIN_COMPARED_TRIPS)}–{String(MAX_COMPARED_TRIPS)} hành trình
        </legend>
        <ul className="space-y-1">
          {candidates.map((trip) => (
            <li key={trip.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-teal-700"
                  checked={selectedIds.includes(trip.id)}
                  disabled={
                    !selectedIds.includes(trip.id) && selectedIds.length >= MAX_COMPARED_TRIPS
                  }
                  onChange={() => {
                    toggle(trip.id);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {trip.name}
                  </span>
                  <span className="block text-sm text-slate-600">
                    {formatDateTime(trip.startedAt)} · {formatDuration(trip.elapsedMs)}
                  </span>
                </span>
                {selectedIds.includes(trip.id) && (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: colorOf(trip.id) }}
                  />
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {selected.length < MIN_COMPARED_TRIPS && (
        <p className="text-sm text-slate-600">
          Chọn thêm hành trình để xem bảng so sánh ({String(selected.length)}/
          {String(MIN_COMPARED_TRIPS)}).
        </p>
      )}
      {error && <Notice tone="error">Không đọc được dữ liệu của hành trình đã chọn.</Notice>}
      {loading && <p className="text-sm text-slate-600">Đang tính toán…</p>}

      {!loading && selected.length >= MIN_COMPARED_TRIPS && comparison.rows.length > 0 && (
        <>
          {comparison.mixedModes && (
            <Notice tone="warn" testId="compare-mixed-modes">
              Các hành trình đã chọn khác phương tiện nên không so sánh ngang nhau được.
            </Notice>
          )}
          {comparison.lowCoverageCount > 0 && (
            <Notice tone="warn" testId="compare-low-coverage">
              {comparison.lowCoverageCount} hành trình có độ phủ GPS thấp. Quãng đường của chúng chỉ
              là phần đo được, nên chênh lệch có thể do thiếu dữ liệu chứ không phải do đường đi.
            </Notice>
          )}

          <LazyTrackMap
            segments={segments}
            segmentColors={segmentColors}
            fitToTrack
            className="h-64 w-full rounded-2xl"
            ariaLabel="Bản đồ chồng các hành trình đã chọn"
          />

          <div className="overflow-x-auto">
            <table
              className="w-full min-w-[32rem] border-collapse text-sm"
              data-testid="compare-table"
            >
              <caption className="sr-only">Bảng so sánh hành trình</caption>
              <thead>
                <tr className="text-left text-slate-600">
                  <th scope="col" className="p-2">
                    Hành trình
                  </th>
                  <th scope="col" className="p-2">
                    Thời gian
                  </th>
                  <th scope="col" className="p-2">
                    Chênh lệch
                  </th>
                  <th scope="col" className="p-2">
                    GPS đo được
                  </th>
                  <th scope="col" className="p-2">
                    Độ phủ
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.tripId} className="border-t border-slate-200 align-top">
                    <th scope="row" className="p-2 text-left font-semibold text-slate-900">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: colorOf(row.tripId) }}
                        />
                        <Link to={`/trips/${row.tripId}`} className="underline">
                          {row.name}
                        </Link>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {row.importedFromGpx && (
                          <StatusPill live={false} tone="info" label="Nhập từ GPX" />
                        )}
                        {row.isIncomplete && (
                          <StatusPill live={false} tone="warn" label="Chưa đầy đủ" />
                        )}
                      </span>
                    </th>
                    <td className="p-2 tabular-nums">{formatDuration(row.elapsedMs)}</td>
                    <td className="p-2 tabular-nums">
                      {row.tripId === comparison.fastestTripId
                        ? 'nhanh nhất'
                        : `+${formatDuration(row.elapsedDeltaMs)}`}
                    </td>
                    <td className="p-2 tabular-nums">{formatDistance(row.distanceMeasuredM)}</td>
                    <td className="p-2">
                      <StatusPill
                        live={false}
                        tone={qualityTone(row.qualityLabel)}
                        label={`${formatPercent(row.coveragePct)} · ${QUALITY_LABELS[row.qualityLabel]}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-slate-600" data-testid="compare-distribution">
            {comparison.medianElapsedMs === null
              ? `Trung vị và P90 cần ít nhất ${String(MIN_TRIPS_FOR_DISTRIBUTION)} hành trình để có ý nghĩa — hiện chưa đủ.`
              : `Trung vị ${formatDuration(comparison.medianElapsedMs)} · P90 ${formatDuration(comparison.p90ElapsedMs ?? 0)} (trên ${String(comparison.rows.length)} hành trình).`}
          </p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">So sánh</h1>
      {children}
    </div>
  );
}
