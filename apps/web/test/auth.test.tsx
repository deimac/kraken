import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../src/pages/Login';
import { mockApi, reply } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const empty = { campaigns: [] };

describe('login and session', () => {
  it('sends unauthenticated visitors to login and back after signing in', async () => {
    let me: unknown = reply(401, { error: 'unauthenticated' });
    mockApi({
      'GET /api/auth/me': () => me,
      'POST /api/auth/login': () => { me = { user: partnerUser }; return { user: partnerUser }; },
      'GET /api/campaigns': empty,
    });
    renderAt('/parceiro/assinaturas');
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('E-mail'), 'g@a.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-1');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Assinaturas' })).toBeTruthy();
  });

  it('shows a Portuguese message for wrong credentials', async () => {
    mockApi({
      'GET /api/auth/me': reply(401, { error: 'unauthenticated' }),
      'POST /api/auth/login': reply(401, { error: 'invalid_credentials' }),
    });
    renderAt('/entrar');
    await userEvent.type(await screen.findByLabelText('E-mail'), 'x@y.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeTruthy();
  });

  it('keeps advertisers out of partner and admin areas', async () => {
    mockApi({ 'GET /api/auth/me': { user: advertiserUser }, 'GET /api/dashboard': { role: 'advertiser', stats: {}, days: [] } });
    renderAt('/admin/parceiros');
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeTruthy();
    expect(screen.queryByText('Parceiros')).toBeNull();
  });

  it('returns to login when the session expires mid-use', async () => {
    let expired = false;
    mockApi({
      'GET /api/auth/me': () => (expired ? reply(401, { error: 'unauthenticated' }) : { user: partnerUser }),
      'GET /api/campaigns': empty,
      'GET /api/partner/plans': () => { expired = true; return reply(401, { error: 'unauthenticated' }); },
    });
    renderAt('/parceiro/assinaturas');
    await screen.findByRole('heading', { name: 'Assinaturas' });
    await userEvent.click(screen.getByRole('link', { name: /Planos/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Entrar' })).toBeTruthy());
  });

  it('logs out', async () => {
    let logged = true;
    mockApi({
      'GET /api/auth/me': () => (logged ? { user: partnerUser } : reply(401, { error: 'unauthenticated' })),
      'GET /api/campaigns': empty,
      'POST /api/auth/logout': () => { logged = false; return reply(204); },
    });
    renderAt('/parceiro/assinaturas');
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy();
  });

  it('sends bare area URLs to the area home', async () => {
    mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/dashboard': { role: 'partner', stats: {}, expiring: [], tv: { configured: false, lastSeenAt: null, online: false }, days: [] } });
    renderAt('/parceiro');
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeTruthy();
  });
});

describe('safeReturnPath', () => {
  it('accepts only same-origin app paths', () => {
    expect(safeReturnPath('/parceiro/planos')).toBe('/parceiro/planos');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example', 'parceiro', null]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
});
