import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BarChart } from '../src/ui';
import { mockApi } from './mock-api';
import { adminUser, advertiserUser, partnerUser, renderAt } from './render';

const days = [
  { day: '2026-10-11', count: 0 },
  { day: '2026-10-12', count: 40 },
  { day: '2026-10-13', count: 12 },
];
const stat = (label: string) => screen.getByText(label, { selector: '.stat-label' }).parentElement!.textContent;

describe('home dashboard', () => {
  it('partner sees what is on air, what needs attention and the TV status', async () => {
    mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/dashboard': {
        role: 'partner',
        stats: { live: 2, paused: 1, advertisers: 4, pendingPieces: 3, paymentPending: 2, playsToday: 12, plays7d: 52, playsMonth: 300 },
        expiring: [{ id: 'c1', name: 'Loja Fit · Ouro', advertiserName: 'Loja Fit', endsAt: '2026-10-20T03:00:00Z' }],
        tv: { configured: true, lastSeenAt: '2026-10-13T12:00:00Z', online: false },
        days,
      },
    });
    renderAt('/parceiro');
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeTruthy();
    expect(stat('No ar')).toContain('2');
    expect(stat('Peças aguardando')).toContain('3');
    expect(stat('Pagamentos pendentes')).toContain('2');
    expect(stat('Inserções hoje')).toContain('12');
    expect(screen.getByText('TV offline')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Loja Fit · Ouro/ }).getAttribute('href')).toBe('/parceiro/assinaturas/c1');
    expect(screen.getByRole('link', { name: /aprovar/i }).getAttribute('href')).toBe('/parceiro/assinaturas');
    expect(screen.getByRole('figure', { name: 'Inserções por dia' })).toBeTruthy();
  });

  it('partner without a TV account is guided to set it up', async () => {
    mockApi({
      'GET /api/auth/me': { user: partnerUser },
      'GET /api/dashboard': { role: 'partner', stats: { live: 0 }, expiring: [], tv: { configured: false, lastSeenAt: null, online: false }, days },
    });
    renderAt('/parceiro/inicio');
    expect(await screen.findByText('TV não configurada')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Configurar a TV' }).getAttribute('href')).toBe('/parceiro/tv');
  });

  it('advertiser sees its plays and pieces', async () => {
    mockApi({
      'GET /api/auth/me': { user: advertiserUser },
      'GET /api/dashboard': { role: 'advertiser', stats: { live: 1, livePieces: 2, pendingPieces: 1, playsToday: 5, plays7d: 30, playsMonth: 90 }, days },
    });
    renderAt('/anunciante');
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeTruthy();
    expect(stat('Inserções no mês')).toContain('90');
    expect(stat('Peças no ar')).toContain('2');
  });

  it('admin sees the network', async () => {
    mockApi({
      'GET /api/auth/me': { user: adminUser },
      'GET /api/dashboard': { role: 'admin', stats: { partners: 3, tvsTotal: 2, tvsOnline: 1, live: 5, playsToday: 70, plays7d: 400, playsMonth: 900 }, days },
    });
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Início' })).toBeTruthy();
    expect(stat('TVs online')).toContain('1/2');
  });
});

describe('BarChart', () => {
  it('exposes the numbers as a table and shows a tooltip on hover', async () => {
    render(<BarChart label="Inserções por dia" data={days.map((d) => ({ label: d.day, value: d.count }))} format={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} />);
    expect(screen.getByRole('figure', { name: 'Inserções por dia' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '40' })).toBeTruthy();
    // screen readers get the table; the bars are decoration with a mouse tooltip and no tab stops
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
    await userEvent.hover(document.querySelector('[data-label="2026-10-12"]')!);
    expect(screen.getByText('12/10: 40')).toBeTruthy();
  });

  it('draws an all-zero series without breaking', () => {
    render(<BarChart label="Vazio" data={[{ label: 'a', value: 0 }, { label: 'b', value: 0 }]} />);
    expect(document.querySelectorAll('.chart-col')).toHaveLength(2);
  });
});
