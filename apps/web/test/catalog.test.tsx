import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, reply } from './mock-api';
import { partnerUser, renderAt } from './render';

const adv = (o: object = {}) => ({
  id: 'a1', name: 'Loja Fit', personType: 'pj', document: '11222333000181', legalName: 'Loja Fit LTDA', contactName: 'Bia',
  email: 'bia@lojafit.com', phone: null, whatsapp: null, zip: null, street: null, number: null, complement: null,
  district: null, city: 'São Paulo', state: 'SP', notes: null, source: 'self_signup', archivedAt: null, activeCampaigns: 1, ...o,
});

describe('advertisers', () => {
  it('lists with stats and searches on the server', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers': { advertisers: [adv(), adv({ id: 'a2', name: 'Clínica Vida', activeCampaigns: 0, source: 'manual' })] },
      'GET /api/partner/advertisers?archived=1': { advertisers: [adv({ id: 'a3', name: 'Antiga', archivedAt: '2026-01-01T00:00:00Z' })] },
      'GET /api/partner/advertisers?q=vida': { advertisers: [adv({ id: 'a2', name: 'Clínica Vida', activeCampaigns: 0 })] },
    });
    renderAt('/parceiro/anunciantes');
    expect(await screen.findByText('Loja Fit')).toBeTruthy();
    expect(screen.getAllByText('11.222.333/0001-81', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('autocadastro')).toBeTruthy();
    expect(screen.getByText('Com assinatura no ar').parentElement!.textContent).toContain('1');
    expect(screen.getByText('Arquivados', { selector: '.stat-label' }).parentElement!.textContent).toContain('1');
    await userEvent.type(screen.getByLabelText('Buscar'), 'vida');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/partner/advertisers?q=vida')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Loja Fit')).toBeNull());
    expect(screen.getByRole('link', { name: /Clínica Vida/ }).getAttribute('href')).toBe('/parceiro/anunciantes/a2');
  });

  it('creates a company with masked inputs sending digits only', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'POST /api/partner/advertisers': (b: unknown) => reply(201, { advertiser: adv({ id: 'a9', ...(b as object) }) }),
      'GET /api/partner/advertisers/a9': { advertiser: adv({ id: 'a9', name: 'Clínica Vida' }), campaigns: [], playsThisMonth: 0 },
    });
    renderAt('/parceiro/anunciantes/novo');
    await userEvent.type(await screen.findByLabelText('Nome fantasia'), 'Clínica Vida');
    await userEvent.type(screen.getByLabelText('CNPJ'), '11222333000181');
    expect((screen.getByLabelText('CNPJ') as HTMLInputElement).value).toBe('11.222.333/0001-81');
    await userEvent.type(screen.getByLabelText('CEP'), '01001000');
    await userEvent.selectOptions(screen.getByLabelText('UF'), 'SP');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar anunciante' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Clínica Vida', personType: 'pj', document: '11222333000181', zip: '01001000', state: 'SP',
    });
    expect(await screen.findByRole('heading', { name: 'Clínica Vida' })).toBeTruthy();
  });

  it('switches to CPF fields for individuals', async () => {
    mockApi({ 'GET /api/auth/me': { user: partnerUser } });
    renderAt('/parceiro/anunciantes/novo');
    await userEvent.selectOptions(await screen.findByLabelText('Tipo'), 'pf');
    expect(screen.getByLabelText('CPF')).toBeTruthy();
    expect(screen.getByLabelText('Nome')).toBeTruthy();
    expect(screen.queryByLabelText('Razão social')).toBeNull();
  });

  it('edits with PATCH, nulling cleared fields', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers/a1': { advertiser: adv(), campaigns: [], playsThisMonth: 0 },
      'PATCH /api/partner/advertisers/a1': (b: unknown) => ({ advertiser: adv(b as object) }),
    });
    renderAt('/parceiro/anunciantes/a1/editar');
    const contact = await screen.findByLabelText('Pessoa de contato');
    await waitFor(() => expect((contact as HTMLInputElement).value).toBe('Bia'));
    await userEvent.clear(contact);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    const body = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: 'Loja Fit', contactName: null, document: '11222333000181', city: 'São Paulo' });
  });

  it('shows detail and archives, and explains why delete failed', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/advertisers/a1': {
        advertiser: adv(), playsThisMonth: 42,
        campaigns: [{ id: 'c1', name: 'Verão', status: 'approved', effectiveStatus: 'active', startsAt: '2026-10-01T03:00:00Z', endsAt: '2026-11-01T03:00:00Z' }],
      },
      'POST /api/partner/advertisers/a1/archive': { advertiser: adv({ archivedAt: '2026-10-12T00:00:00Z' }) },
      'DELETE /api/partner/advertisers/a1': reply(409, { error: 'has_subscriptions' }),
    });
    renderAt('/parceiro/anunciantes/a1');
    expect(await screen.findByRole('heading', { name: 'Loja Fit' })).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Verão/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/partner/advertisers/a1/archive')).toBe(true);
    expect(await screen.findByRole('button', { name: 'Desarquivar' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Este anunciante tem assinaturas; arquive em vez de excluir.')).toBeTruthy();
  });
});

const plan = (o: object = {}) => ({
  id: 'pl1', name: 'Ouro', description: 'Mais exibições', frequencyLevel: 'high', active: true,
  maxVideos: 2, maxImages: 3, maxVideoSeconds: 30, priceCents: 30000, periodMonths: 1, ...o,
});

describe('ad plans', () => {
  it('shows plan cards with price and limits, and archives', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/plans': { plans: [plan(), plan({ id: 'pl2', name: 'Antigo', active: false })] },
      'POST /api/partner/plans/pl1/archive': { plan: plan({ active: false }) },
    });
    renderAt('/parceiro/planos');
    expect(await screen.findByRole('heading', { name: 'Planos de anúncio' })).toBeTruthy();
    expect(await screen.findByText('Ouro')).toBeTruthy();
    expect(screen.getByText(/300,00\/mês/)).toBeTruthy();
    expect(screen.getByText('Até 2 vídeos de até 30 s · até 3 imagens')).toBeTruthy();
    expect(screen.queryByText('Antigo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Arquivar Ouro' }));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/partner/plans/pl1/archive')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Arquivados' }));
    expect(await screen.findByText('Antigo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reativar Ouro' })).toBeTruthy();
  });

  it('creates a plan with limits and price', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/plans': { plans: [] },
      'POST /api/partner/plans': (b: unknown) => reply(201, { plan: plan({ id: 'pl9', ...(b as object) }) }),
    });
    renderAt('/parceiro/planos');
    await userEvent.click(await screen.findByRole('button', { name: 'Novo plano' }));
    await userEvent.type(screen.getByLabelText('Nome do plano'), 'Prata');
    await userEvent.selectOptions(screen.getByLabelText('Frequência'), 'medium');
    await userEvent.clear(screen.getByLabelText('Vídeos'));
    await userEvent.type(screen.getByLabelText('Vídeos'), '2');
    await userEvent.clear(screen.getByLabelText('Imagens'));
    await userEvent.type(screen.getByLabelText('Imagens'), '0');
    await userEvent.type(screen.getByLabelText('Valor (R$)'), '1.250,50');
    await userEvent.selectOptions(screen.getByLabelText('Período'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Prata', frequencyLevel: 'medium', maxVideos: 2, maxImages: 0, maxVideoSeconds: 30, priceCents: 125050, periodMonths: 3,
    });
    expect(await screen.findByText('Prata')).toBeTruthy();
  });

  it('shows limit errors inside the form without calling the API', async () => {
    const calls = mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/partner/plans': { plans: [] } });
    renderAt('/parceiro/planos');
    await userEvent.click(await screen.findByRole('button', { name: 'Novo plano' }));
    await userEvent.type(screen.getByLabelText('Nome do plano'), 'Vazio');
    await userEvent.clear(screen.getByLabelText('Vídeos'));
    await userEvent.type(screen.getByLabelText('Vídeos'), '0');
    await userEvent.clear(screen.getByLabelText('Imagens'));
    await userEvent.type(screen.getByLabelText('Imagens'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Criar plano' }));
    const form = screen.getByRole('button', { name: 'Criar plano' }).closest('form')!;
    expect(within(form).getByText('O plano precisa permitir ao menos um vídeo ou uma imagem.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('edits a plan with PATCH', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner/plans': { plans: [plan()] },
      'PATCH /api/partner/plans/pl1': (b: unknown) => ({ plan: plan(b as object) }),
    });
    renderAt('/parceiro/planos');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Ouro' }));
    const name = screen.getByLabelText('Nome do plano');
    expect((name as HTMLInputElement).value).toBe('Ouro');
    expect((screen.getByLabelText('Valor (R$)') as HTMLInputElement).value).toBe('300,00');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ouro Plus');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ name: 'Ouro Plus', priceCents: 30000, maxVideos: 2 });
    expect(await screen.findByText('Ouro Plus')).toBeTruthy();
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

  it('lets the partner choose the transition', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/partner': { partner: { id: 'p1', name: 'Ironberg', slug: 'ironberg', transition: 'fade', transitionMs: 600 } },
      'PATCH /api/partner/settings': (b: unknown) => ({ partner: { id: 'p1', slug: 'ironberg', ...(b as object) } }),
    });
    renderAt('/parceiro/tv');
    const type = await screen.findByLabelText('Transição entre anúncios');
    await screen.findByText('tv@ironberg');
    expect((type as HTMLSelectElement).value).toBe('fade');
    await userEvent.selectOptions(type, 'slide');
    await userEvent.selectOptions(screen.getByLabelText('Duração'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar transição' }));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ transition: 'slide', transitionMs: 1000 });
    expect(await screen.findByText('Transição salva. As TVs aplicam em até 5 minutos.')).toBeTruthy();
  });
});
