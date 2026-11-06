import { COPY } from '@/app/copy';
import { Notice } from '@/components/ui/Notice';

/** NFR-11: never promise background / locked-screen GPS. */
export function PlatformLimitNotice({ detailed = false }: { detailed?: boolean }) {
  return (
    <Notice tone="info" testId="platform-limit-notice" title={COPY.platformHint}>
      {detailed ? COPY.platformDetail : undefined}
    </Notice>
  );
}
