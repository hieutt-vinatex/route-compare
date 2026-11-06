import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function renderDialog() {
  // A new inline onCancel on every render, exactly like the Tracking page's 1-second ticks.
  return (
    <ConfirmDialog
      open
      title="Kết thúc hành trình?"
      confirmLabel="Kết thúc"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />
  );
}

describe('ConfirmDialog (NFR-13, review I4)', () => {
  it('moves focus into the dialog once when it opens', () => {
    render(renderDialog());
    expect(screen.getByRole('button', { name: 'Quay lại' })).toHaveFocus();
  });

  it('does not steal focus back when the parent re-renders while open', () => {
    const { rerender } = render(renderDialog());
    const confirm = screen.getByRole('button', { name: 'Kết thúc' });
    confirm.focus();
    rerender(renderDialog());
    rerender(renderDialog());
    expect(confirm).toHaveFocus();
  });
});
