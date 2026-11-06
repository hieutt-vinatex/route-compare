import { Icon, type IconName } from './Icon';

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'neutral' | 'recording';

const TONES: Record<Tone, { cls: string; icon: IconName }> = {
  ok: { cls: 'bg-emerald-50 text-emerald-900 ring-emerald-300', icon: 'check' },
  recording: { cls: 'bg-red-50 text-red-900 ring-red-300', icon: 'record' },
  warn: { cls: 'bg-amber-50 text-amber-900 ring-amber-300', icon: 'warning' },
  error: { cls: 'bg-red-50 text-red-900 ring-red-300', icon: 'error' },
  info: { cls: 'bg-sky-50 text-sky-900 ring-sky-300', icon: 'info' },
  neutral: { cls: 'bg-slate-100 text-slate-800 ring-slate-300', icon: 'info' },
};

/** Status is conveyed by icon + text, not by colour alone (NFR-13). */
export function StatusPill({
  tone,
  label,
  testId,
}: {
  tone: Tone;
  label: string;
  testId?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      role="status"
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${t.cls}`}
    >
      <Icon name={t.icon} className="h-4 w-4" />
      {label}
    </span>
  );
}
