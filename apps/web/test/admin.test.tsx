import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { slugify } from '../src/pages/admin/Partners';
import { mockApi } from './mock-api';
import { adminUser, renderAt } from './render';

const partner = {
  id: 'p1', name: 'Ironberg', slug: 'ironberg', status: 'active', showInstitutional: false,
  weightLow: 1, weightMedium: 2, weightHigh: 3, defaultImageSeconds: 10,
};

describe('slugify', () => {
  it('builds URL-safe slugs from names', () => {
    expect(slugify('Academia São João  Fit!')).toBe('academia-sao-joao-fit');
  });
});

describe('admin partners', () => {
  it('lists partners and creates one with a generated slug', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'GET /api/admin/midora-plans': { plans: [] },
      'POST /api/admin/partners': (b: unknown) => ({ partner: { ...partner, id: 'p2', ...(b as object) } }),
    });
    renderAt('/admin/parceiros');
    expect(await screen.findByText('Ironberg')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nome do parceiro'), 'Studio Forma');
    expect((screen.getByLabelText('Endereço (slug)') as HTMLInputElement).value).toBe('studio-forma');
    await userEvent.click(screen.getByRole('button', { name: 'Criar parceiro' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Studio Forma', slug: 'studio-forma', showInstitutional: false });
  });

  it('edits weights and adds a partner user', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/partners': { partners: [partner] },
      'GET /api/admin/midora-plans': { plans: [] },
      'PATCH /api/admin/partners/p1': (b: unknown) => ({ partner: { ...partner, ...(b as object) } }),
      'POST /api/admin/partners/p1/users': { user: { id: 'u9', email: 'g@iron.com', role: 'partner_user' } },
    });
    renderAt('/admin/parceiros');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Ironberg' }));
    const editor = screen.getByRole('region', { name: 'Editar Ironberg' });
    const high = within(editor).getByLabelText('Peso alta');
    await userEvent.clear(high);
    await userEvent.type(high, '5');
    await userEvent.click(within(editor).getByLabelText('Exibir anúncios institucionais'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Salvar' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ weightHigh: 5, showInstitutional: true });
    await userEvent.type(within(editor).getByLabelText('E-mail do usuário'), 'g@iron.com');
    await userEvent.type(within(editor).getByLabelText('Senha inicial'), 'senha-forte-1');
    await userEvent.click(within(editor).getByRole('button', { name: 'Adicionar usuário' }));
    expect(await screen.findByText('Usuário g@iron.com criado.')).toBeTruthy();
  });
});

describe('admin institutional campaigns', () => {
  it('creates an institutional campaign with an inclusive date range', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/admin/campaigns': { campaigns: [] },
      'POST /api/admin/campaigns': (b: unknown) => ({ campaign: { id: 'c1', name: 'Anuncie aqui', status: 'approved', effectiveStatus: 'scheduled', ...(b as object) } }),
    });
    renderAt('/admin/institucionais');
    await userEvent.type(await screen.findByLabelText('Nome'), 'Anuncie aqui');
    await userEvent.type(screen.getByLabelText('Início'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('Fim'), '2026-11-30');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    const body = calls.find((c) => c.method === 'POST')!.body as { startsAt: string; endsAt: string; frequencyLevel: string };
    expect(new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()).toBe(30 * 86_400_000);
    expect(body.frequencyLevel).toBe('low');
  });
});
