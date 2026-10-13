import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from './mock-api';
import { advertiserUser, partnerUser, renderAt } from './render';

const report = {
  from: '2026-10-01', to: '2026-10-12',
  campaigns: [
    { campaignId: 'c1', name: 'Verão', kind: 'commercial', advertiserName: 'Loja Fit', total: 120, days: [{ day: '2026-10-10', count: 50 }, { day: '2026-10-11', count: 70 }], pieces: [{ mediaId: 'm1', label: 'jeep.mp4', mediaType: 'video', total: 80 }, { mediaId: 'm2', label: 'banner.png', mediaType: 'image', total: 40 }] },
    { campaignId: 'c2', name: 'Anuncie aqui', kind: 'institutional', advertiserName: null, total: 30, days: [{ day: '2026-10-11', count: 30 }], pieces: [{ mediaId: 'm3', label: 'kraken.png', mediaType: 'image', total: 30 }] },
  ],
};

describe('reports', () => {
  it('shows totals, expands days and links the CSV for the chosen period', async () => {
    const calls = mockApi({ 'GET /api/auth/me': { user: partnerUser }, 'GET /api/reports/plays': report });
    renderAt('/parceiro/relatorios');
    expect(await screen.findByText('Verão')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('Total no período: 150 inserções')).toBeTruthy();
    expect(screen.getByText(/Kraken Ads · institucional/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver dias de Verão' }));
    expect(screen.getByText('11/10/2026')).toBeTruthy();
    expect(screen.getByText('70')).toBeTruthy();

    await userEvent.clear(screen.getByLabelText('De'));
    await userEvent.type(screen.getByLabelText('De'), '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(calls.some((c) => c.path.startsWith('/api/reports/plays?from=2026-09-01&to='))).toBe(true);
    const csv = screen.getByRole('link', { name: 'Baixar CSV' }) as HTMLAnchorElement;
    expect(csv.getAttribute('href')).toMatch(/^\/api\/reports\/plays\.csv\?from=2026-09-01&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('is available to advertisers and explains an empty period', async () => {
    mockApi({ 'GET /api/auth/me': { user: advertiserUser }, 'GET /api/reports/plays': { from: 'x', to: 'y', campaigns: [] } });
    renderAt('/anunciante/relatorios');
    expect(await screen.findByText('Nenhuma inserção no período.')).toBeTruthy();
  });
});
