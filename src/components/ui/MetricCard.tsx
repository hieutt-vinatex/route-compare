export function MetricCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p data-testid={testId} className="mt-1 text-xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
      {hint !== undefined && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
