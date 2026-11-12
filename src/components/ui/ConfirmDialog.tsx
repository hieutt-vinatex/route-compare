import { useEffect, useEffectEvent, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from './Button';

/**
 * Modal confirm. `children` adds content (e.g. a text field); `initialFocusRef` focuses it instead
 * of the cancel button when the dialog opens.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Quay lại',
  danger = false,
  confirmDisabled = false,
  initialFocusRef,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Reads the latest onCancel without re-running effects on every parent render.
  const onEscape = useEffectEvent(() => {
    onCancel();
  });

  // Focus moves into the dialog only when it opens — never on later re-renders (review I4) —
  // and returns to the element that opened it when it closes.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? cancelRef.current)?.focus();
    return () => {
      opener?.focus();
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descId}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          // aria-modal: keyboard focus must not wander to the page behind the overlay.
          const focusable = e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <h2 id={titleId} className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        {description !== undefined && (
          <p id={descId} className="mt-2 text-sm text-slate-700">
            {description}
          </p>
        )}
        {children}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
