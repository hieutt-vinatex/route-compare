import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ConfirmDialog keyboard focus (NFR-13)', () => {
  it('keeps Tab and Shift+Tab inside the open dialog', async () => {
    render(
      <>
        <button type="button">Trên trang</button>
        <ConfirmDialog
          open
          title="Đổi tên"
          confirmLabel="Lưu"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        >
          <input aria-label="Tên" />
        </ConfirmDialog>
      </>,
    );
    const input = screen.getByLabelText('Tên');
    const save = screen.getByRole('button', { name: 'Lưu' });
    save.focus();
    await userEvent.tab();
    expect(input).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(save).toHaveFocus();
  });
});
