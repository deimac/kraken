import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, EmptyState, SearchInput, StatCard } from '../src/ui';

describe('ui kit', () => {
  it('renders stat cards and empty states', () => {
    render(<><StatCard label="Ativos" value={3} /><EmptyState title="Nada aqui">Cadastre o primeiro.</EmptyState></>);
    expect(screen.getByText('Ativos')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Nada aqui')).toBeTruthy();
  });

  it('search input reports typed text', async () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Nome ou CNPJ" />);
    await userEvent.type(screen.getByLabelText('Buscar'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('confirm dialog confirms and cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} title="Excluir?" confirmLabel="Excluir" onConfirm={onConfirm} onCancel={onCancel}>Sem volta.</ConfirmDialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ConfirmDialog open title="Excluir?" confirmLabel="Excluir" danger onConfirm={onConfirm} onCancel={onCancel}>Sem volta.</ConfirmDialog>);
    expect(screen.getByRole('dialog', { name: 'Excluir?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});
