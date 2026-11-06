import { useEffect, useState } from 'react';
import { useServices } from './useServices';

/** True while another tab of this browser holds the recorder lock (FR-13). */
export function useRecorderBusy(): boolean {
  const { lock } = useServices();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void lock.heldElsewhere().then((held) => {
        if (!cancelled) setBusy(held);
      });
    };
    refresh();
    const unsubscribe = lock.onChange(refresh);
    // Another tab may have closed while this one was in the background.
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [lock]);
  return busy;
}
