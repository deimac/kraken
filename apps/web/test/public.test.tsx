import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, renderAt } from './render';

describe('public partner page', () => {
  it('shows plans and signs up an advertiser', async () => {
    let me: unknown = reply(401, { error: 'unauthenticated' });
    const calls = mockApi({
      'GET /api/auth/me': () => me,
      'GET /api/public/partners/ironberg': {
        partner: { name: 'Ironberg', slug: 'ironberg' },
        plans: [{ id: 'pl1', name: 'Ouro', description: 'Mais exibições', frequencyLevel: 'high' }],
      },
      'POST /api/public/partners/ironberg/advertisers': () => { me = { user: advertiserUser }; return reply(201, { user: advertiserUser }); },
      'GET /api/campaigns': { campaigns: [] },
    });
    renderAt('/p/ironberg');
    expect(await screen.findByRole('heading', { name: 'Anuncie na Ironberg' })).toBeTruthy();
    expect(screen.getByText('Mais exibições')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Empresa'), 'Loja Fit');
    await userEvent.type(screen.getByLabelText('CNPJ'), '11222333000181');
    await userEvent.type(screen.getByLabelText('Seu nome'), 'Bia');
    await userEvent.type(screen.getByLabelText('E-mail'), 'bia@lojafit.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-loja-1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      companyName: 'Loja Fit', contactName: 'Bia', email: 'bia@lojafit.com', password: 'senha-loja-1', personType: 'pj', document: '11222333000181',
    });
    expect(await screen.findByRole('heading', { name: 'Minhas campanhas' })).toBeTruthy();
  });

  it('shows a not-found message for unknown partners', async () => {
    mockApi({ 'GET /api/auth/me': reply(401, { error: 'unauthenticated' }) });
    renderAt('/p/nao-existe');
    expect(await screen.findByText('Página não encontrada.')).toBeTruthy();
  });
});
