import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from './mock-api';
import { partnerUser, renderAt } from './render';

describe('advertisers', () => {
  it('lists and creates advertisers', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [{ id: 'a1', name: 'Loja Fit', contactName: 'Bia', email: null, phone: null, source: 'self_signup' }] },
      'POST /api/partner/advertisers': (b: unknown) => ({ advertiser: { id: 'a2', source: 'manual', contactName: null, email: null, phone: null, ...(b as object) } }),
    });
    renderAt('/parceiro/anunciantes');
    expect(await screen.findByText('Loja Fit')).toBeTruthy();
    expect(screen.getByText(/autocadastro/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Empresa'), 'Clínica Vida');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar anunciante' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Clínica Vida' });
    expect(await screen.findByText('Clínica Vida')).toBeTruthy();
  });
});

describe('ad plans', () => {
  it('creates plans and toggles active', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: true }] },
      'POST /api/partner/plans': (b: unknown) => ({ plan: { id: 'pl2', active: true, description: '', ...(b as object) } }),
      'PATCH /api/partner/plans/pl1': { plan: { id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: false } },
    });
    renderAt('/parceiro/planos');
    expect(await screen.findByRole('heading', { name: 'Planos de anúncio' })).toBeTruthy();
    expect(await screen.findByText('Ouro')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Desativar Ouro' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ active: false });
    expect(await screen.findByRole('button', { name: 'Ativar Ouro' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nome do plano'), 'Prata');
    await userEvent.selectOptions(screen.getByLabelText('Frequência'), 'medium');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ name: 'Prata', frequencyLevel: 'medium' });
  });
});

describe('TV account', () => {
  it('shows the TV login and sets a password', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner': { partner: { id: 'p1', name: 'Ironberg', slug: 'ironberg' } },
      'PUT /api/partner/player-account': { login: 'tv@ironberg' },
    });
    renderAt('/parceiro/tv');
    expect(await screen.findByText('tv@ironberg')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Nova senha da TV'), 'senha-tv-123');
    await userEvent.click(screen.getByRole('button', { name: 'Definir senha' }));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ password: 'senha-tv-123' });
    expect(await screen.findByText(/TVs conectadas foram desconectadas/)).toBeTruthy();
  });
});
