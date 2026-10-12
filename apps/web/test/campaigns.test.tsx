import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const base = {
  kind: 'commercial', frequencyLevel: 'high', startsAt: '2026-11-01T03:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z',
  advertiserId: 'a1', advertiserName: 'Loja Fit', currentMediaId: 'm1',
};
const pending = { ...base, id: 'c1', name: 'Black Friday', status: 'pending_review', effectiveStatus: 'pending_review' };
const changes = { ...base, id: 'c2', name: 'Verão', status: 'changes_requested', effectiveStatus: 'changes_requested' };
const media = { id: 'm1', mediaType: 'image', mime: 'image/png', durationMs: null, displaySeconds: 10 };

describe('campaign list', () => {
  it('shows counts, advertiser names and statuses', async () => {
    mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/campaigns': { campaigns: [pending, changes] } });
    renderAt('/parceiro/campanhas');
    expect(await screen.findByText('Black Friday')).toBeTruthy();
    expect(screen.getAllByText(/Loja Fit/).length).toBe(2);
    expect(screen.getAllByText('Aguardando aprovação').length).toBeGreaterThan(0);
    expect(screen.getByText('Correção pedida')).toBeTruthy();
  });
});

describe('creating a campaign', () => {
  it('partner picks advertiser and plan; one-day period becomes 24h', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [{ id: 'a1', name: 'Loja Fit', source: 'manual' }] },
      'GET /api/partner/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: true }, { id: 'pl2', name: 'Velho', description: '', frequencyLevel: 'low', active: false }] },
      'POST /api/campaigns': { campaign: { ...pending, id: 'c9', status: 'draft', effectiveStatus: 'draft' } },
      'GET /api/campaigns/c9': { campaign: { ...pending, id: 'c9', status: 'draft', effectiveStatus: 'draft', currentMediaId: null }, media: null, reviews: [] },
    });
    renderAt('/parceiro/campanhas/nova');
    await screen.findByRole('option', { name: 'Loja Fit' });
    await screen.findByRole('option', { name: /Ouro/ });
    await userEvent.selectOptions(screen.getByLabelText('Anunciante'), 'a1');
    expect(screen.queryByRole('option', { name: /Velho/ })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Plano'), 'pl1');
    await userEvent.type(screen.getByLabelText('Nome da campanha'), 'Natal');
    await userEvent.type(screen.getByLabelText('Primeiro dia'), '2026-12-24');
    await userEvent.type(screen.getByLabelText('Último dia'), '2026-12-24');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, string>;
    expect(body).toMatchObject({ advertiserId: 'a1', planId: 'pl1', name: 'Natal' });
    expect(new Date(body.endsAt!).getTime() - new Date(body.startsAt!).getTime()).toBe(86_400_000);
    expect(await screen.findByRole('heading', { name: 'Black Friday' })).toBeTruthy();
  });

  it('advertiser uses its own plans and sees a Portuguese error for reversed dates', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/advertiser/plans': { plans: [{ id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high' }] },
    });
    renderAt('/anunciante/campanhas/nova');
    await screen.findByRole('option', { name: /Ouro/ });
    await userEvent.selectOptions(screen.getByLabelText('Plano'), 'pl1');
    expect(screen.queryByLabelText('Anunciante')).toBeNull();
    await userEvent.type(screen.getByLabelText('Nome da campanha'), 'X');
    await userEvent.type(screen.getByLabelText('Primeiro dia'), '2026-12-24');
    await userEvent.type(screen.getByLabelText('Último dia'), '2026-12-20');
    await userEvent.click(screen.getByRole('button', { name: 'Criar campanha' }));
    expect(await screen.findByText('A data de término precisa ser igual ou posterior à de início.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('campaign detail', () => {
  it('partner approves once even on double click', async () => {
    const approved = { ...pending, status: 'approved', effectiveStatus: 'scheduled' };
    let current = pending;
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': () => ({ campaign: current, media, reviews: [] }),
      'POST /api/campaigns/c1/approve': () =>
        new Promise((resolve) => setTimeout(() => { current = approved; resolve({ campaign: approved }); }, 50)),
    });
    renderAt('/parceiro/campanhas/c1');
    const approve = await screen.findByRole('button', { name: 'Aprovar' });
    await userEvent.dblClick(approve);
    await waitFor(() => expect(screen.getByText('Campanha aprovada.')).toBeTruthy());
    expect(calls.filter((c) => c.path === '/api/campaigns/c1/approve').length).toBe(1);
  });

  it('requesting changes needs a reason', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': { campaign: pending, media, reviews: [] },
      'POST /api/campaigns/c1/request-changes': { campaign: { ...pending, status: 'changes_requested', effectiveStatus: 'changes_requested' } },
    });
    renderAt('/parceiro/campanhas/c1');
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir correção' }));
    await userEvent.type(screen.getByLabelText('O que precisa ser corrigido'), 'Logo cortado');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido de correção' }));
    expect(calls.find((c) => c.path.endsWith('request-changes'))!.body).toEqual({ reason: 'Logo cortado' });
  });

  it('advertiser sees the reason, uploads with display seconds and resubmits', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/campaigns/c2': {
        campaign: changes, media,
        reviews: [{ action: 'submitted', reason: null, createdAt: '2026-10-10T10:00:00Z' }, { action: 'changes_requested', reason: 'Logo cortado', createdAt: '2026-10-11T10:00:00Z' }],
      },
      'POST /api/campaigns/c2/media': { media: { ...media, id: 'm2', displaySeconds: 15 } },
      'POST /api/campaigns/c2/submit': { campaign: { ...changes, status: 'pending_review', effectiveStatus: 'pending_review' } },
    });
    renderAt('/anunciante/campanhas/c2');
    expect((await screen.findAllByText(/Logo cortado/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull();
    await userEvent.clear(screen.getByLabelText('Segundos na tela (imagens)'));
    await userEvent.type(screen.getByLabelText('Segundos na tela (imagens)'), '15');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'novo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Arquivo'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar arquivo' }));
    const up = calls.find((c) => c.path.startsWith('/api/campaigns/c2/media'))!;
    expect(up.path).toBe('/api/campaigns/c2/media?displaySeconds=15');
    expect((up.form!.get('file') as File).name).toBe('novo.png');
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    expect(await screen.findByText('Campanha enviada para aprovação.')).toBeTruthy();
  });

  it('keeps the page usable when an upload is rejected', async () => {
    mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/campaigns/c2': { campaign: changes, media, reviews: [] },
      'POST /api/campaigns/c2/media': reply(415, { error: 'unsupported_media' }),
    });
    renderAt('/anunciante/campanhas/c2');
    await userEvent.upload(await screen.findByLabelText('Arquivo'), new File(['x'], 'hevc.mp4', { type: 'video/mp4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar arquivo' }));
    expect(await screen.findByText(/Formato não aceito/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar arquivo' })).toBeTruthy();
  });
});
