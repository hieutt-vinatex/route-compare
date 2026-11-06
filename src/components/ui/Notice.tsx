import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type NoticeTone = 'info' | 'warn' | 'error';

const TONES: Record<NoticeTone, { cls: string; icon: IconName }> = {
  info: { cls: 'border-sky-300 bg-sky-50 text-sky-950', icon: 'info' },
  warn: { cls: 'border-amber-300 bg-amber-50 text-amber-950', icon: 'warning' },
  error: { cls: 'border-red-300 bg-red-50 text-red-950', icon: 'error' },
};

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  testId,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={`flex gap-3 rounded-xl border p-3 text-sm ${t.cls}`}
    >
      <Icon name={t.icon} className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {title !== undefined && <p className="font-semibold">{title}</p>}
        {children !== undefined && <div className="leading-relaxed">{children}</div>}
        {action !== undefined && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}
