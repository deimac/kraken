import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const sub = (o: object = {}) => ({
  id: 'c1', kind: 'commercial', name: 'Loja Fit · Ouro', status: 'active', effectiveStatus: 'active', frequencyLevel: 'high',
  startsAt: '2026-11-01T03:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z', priceCents: 30000, paymentStatus: 'pending',
  advertiserId: 'a1', advertiserName: 'Loja Fit', planName: 'Ouro', pieces: { approved: 2, pending: 1 }, ...o,
});
const plan = {
  id: 'pl1', name: 'Ouro', description: '', frequencyLevel: 'high', active: true, maxVideos: 2, maxImages: 1, maxVideoSeconds: 30,
  priceCents: 30000, periodMonths: 1,
};
const piece = (o: object = {}) => ({
  id: 'm1', mediaType: 'video', mime: 'video/mp4', durationMs: 15000, displaySeconds: null, status: 'approved', reviewReason: null,
  originalName: 'jeep.mp4', createdAt: '2026-11-01T12:00:00Z', ...o,
});
const detail = (o: object = {}) => ({
  campaign: sub(), plan, usage: { videos: 1, images: 1 }, totalPlays: 128,
  pieces: [piece(), piece({ id: 'm2', mediaType: 'image', mime: 'image/png', durationMs: null, displaySeconds: 10, status: 'pending_review', originalName: 'banner.png' })],
  reviews: [{ action: 'created', reason: null, mediaId: null, createdAt: '2026-11-01T12:00:00Z' }],
  ...o,
});

describe('subscription list', () => {
  it('shows stats, advertiser and plan, pieces and payment; old address redirects', async () => {
    mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns': { campaigns: [sub(), sub({ id: 'c2', name: 'Clínica · Bronze', status: 'paused', effectiveStatus: 'paused', paymentStatus: 'paid', pieces: { approved: 0, pending: 0 } })] },
    });
    renderAt('/parceiro/campanhas');
    expect(await screen.findByRole('heading', { name: 'Assinaturas' })).toBeTruthy();
    expect(await screen.findByText('Loja Fit · Ouro')).toBeTruthy();
    expect(screen.getByText('No ar', { selector: '.stat-label' }).parentElement!.textContent).toContain('1');
    expect(screen.getByText('Pausadas', { selector: '.stat-label' }).parentElement!.textContent).toContain('1');
    expect(screen.getByText('Peças aguardando', { selector: '.stat-label' }).parentElement!.textContent).toContain('1');
    expect(screen.getByText(/2 peças no ar · 1 aguardando/)).toBeTruthy();
    expect(screen.getByText('Pagamento pendente', { selector: '.chip' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Loja Fit · Ouro/ })[0]!.getAttribute('href')).toBe('/parceiro/assinaturas/c1');
  });
});

describe('creating a subscription', () => {
  it('partner picks advertiser and plan; end date follows the plan period', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [{ id: 'a1', name: 'Loja Fit', personType: 'pj', source: 'manual' }] },
      'GET /api/partner/plans': { plans: [plan] },
      'POST /api/campaigns': reply(201, { campaign: sub({ id: 'c9' }) }),
      'GET /api/campaigns/c9': detail(),
    });
    renderAt('/parceiro/assinaturas/nova');
    await screen.findByRole('option', { name: 'Loja Fit' });
    await screen.findByRole('option', { name: 'Ouro' });
    await userEvent.selectOptions(screen.getByLabelText('Anunciante'), 'a1');
    await userEvent.selectOptions(screen.getByLabelText('Plano'), 'pl1');
    expect(screen.getByText('Até 2 vídeos de até 30 s · até 1 imagem')).toBeTruthy();
    const start = screen.getByLabelText('Primeiro dia');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-01');
    await waitFor(() => expect((screen.getByLabelText('Último dia') as HTMLInputElement).value).toBe('2026-11-30'));
    await userEvent.click(screen.getByRole('button', { name: 'Criar assinatura' }));
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, string>;
    expect(body).toMatchObject({ advertiserId: 'a1', planId: 'pl1' });
    expect(body.name).toBeUndefined();
    expect(new Date(body.endsAt!).getTime() - new Date(body.startsAt!).getTime()).toBe(30 * 86_400_000);
    expect(await screen.findByRole('heading', { name: 'Loja Fit · Ouro' })).toBeTruthy();
  });
});

describe('subscription page (partner)', () => {
  it('shows plan usage and pieces; approves, rejects, pauses and marks payment', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': detail(),
      'POST /api/campaigns/c1/pieces/m2/approve': { piece: piece({ id: 'm2', status: 'approved' }) },
      'POST /api/campaigns/c1/pieces/m2/reject': { piece: piece({ id: 'm2', status: 'rejected' }) },
      'POST /api/campaigns/c1/pause': { campaign: sub({ status: 'paused', effectiveStatus: 'paused' }) },
      'PATCH /api/campaigns/c1/payment': { campaign: sub({ paymentStatus: 'paid' }) },
    });
    renderAt('/parceiro/assinaturas/c1');
    expect(await screen.findByRole('heading', { name: 'Loja Fit · Ouro' })).toBeTruthy();
    expect(screen.getByText('Vídeos').parentElement!.textContent).toContain('1/2');
    expect(screen.getByText('Imagens').parentElement!.textContent).toContain('1/1');
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('jeep.mp4')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar banner.png' }));
    expect(calls.some((c) => c.path === '/api/campaigns/c1/pieces/m2/approve')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Recusar banner.png' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Logo cortado');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Recusar' }));
    expect(calls.find((c) => c.path === '/api/campaigns/c1/pieces/m2/reject')!.body).toEqual({ reason: 'Logo cortado' });
    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    expect(calls.some((c) => c.path === '/api/campaigns/c1/pause')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como pago' }));
    expect(calls.find((c) => c.path === '/api/campaigns/c1/payment')!.body).toEqual({ paymentStatus: 'paid' });
  });

  it('uploads several files, reporting each result', async () => {
    let n = 0;
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/campaigns/c1': detail(),
      'POST /api/campaigns/c1/pieces': () => (++n === 1 ? reply(201, { piece: piece({ id: 'm9' }) }) : reply(409, { error: 'plan_limit' })),
    });
    renderAt('/parceiro/assinaturas/c1');
    const input = (await screen.findByLabelText('Enviar peças')) as HTMLInputElement;
    await userEvent.upload(input, [
      new File(['a'], 'a.mp4', { type: 'video/mp4' }),
      new File(['b'], 'b.mp4', { type: 'video/mp4' }),
    ]);
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith('/api/campaigns/c1/pieces')).length).toBe(2));
    expect(await screen.findByText(/b.mp4: O plano desta assinatura não tem mais vagas/)).toBeTruthy();
  });
});

describe('subscription page (advertiser)', () => {
  it('cannot manage the subscription but can withdraw its pending pieces', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/campaigns/c1': detail(),
      'POST /api/campaigns/c1/pieces/m2/remove': { piece: piece({ id: 'm2', status: 'removed' }) },
    });
    renderAt('/anunciante/assinaturas/c1');
    expect(await screen.findByRole('heading', { name: 'Loja Fit · Ouro' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprovar banner.png' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover jeep.mp4' })).toBeNull();
    expect(screen.getByText(/passam pela aprovação/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remover banner.png' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover' }));
    expect(calls.some((c) => c.path === '/api/campaigns/c1/pieces/m2/remove')).toBe(true);
  });
});
