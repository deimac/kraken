import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from '../src/format';
import { mockApi } from './mock-api';
import { adminUser, renderAt } from './render';

describe('money', () => {
  it('formats and parses Brazilian reais', () => {
    expect(formatMoney(9900)).toMatch(/R\$\s?99,00/);
    expect(formatMoney(null)).toBe('Sem valor definido');
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('99')).toBe(9900);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeUndefined();
  });
});

describe('Kraken plans screen', () => {
  it('creates a plan with a price in reais', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/kraken-plans': { plans: [] },
      'POST /api/admin/kraken-plans': (b: unknown) => ({ plan: { id: 'mp1', active: true, description: '', ...(b as object) } }),
    });
    renderAt('/admin/planos-kraken');
    await userEvent.type(await screen.findByLabelText('Nome do plano'), 'Essencial');
    await userEvent.type(screen.getByLabelText('Valor mensal de referência (R$)'), '99,90');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Essencial', priceCents: 9990 });
    expect(await screen.findByText('Essencial')).toBeTruthy();
  });

  it('assigns a Kraken plan in the partner editor', async () => {
    const partner = { id: 'p1', name: 'Ironberg', slug: 'ironberg', status: 'active', showInstitutional: false, weightLow: 1, weightMedium: 2, weightHigh: 3, defaultImageSeconds: 10, krakenPlanId: null };
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'GET /api/admin/kraken-plans': { plans: [{ id: 'mp1', name: 'Essencial', description: '', priceCents: 9900, active: true }] },
      'PATCH /api/admin/partners/p1': (b: unknown) => ({ partner: { ...partner, ...(b as object) } }),
    });
    renderAt('/admin/parceiros');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Ironberg' }));
    const editor = screen.getByRole('region', { name: 'Editar Ironberg' });
    await userEvent.selectOptions(within(editor).getByLabelText('Plano Kraken'), 'mp1');
    await userEvent.click(within(editor).getByRole('button', { name: 'Salvar' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ krakenPlanId: 'mp1' });
    expect(await screen.findByText(/Plano Kraken: Essencial/)).toBeTruthy();
  });
});
