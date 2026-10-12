import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partners } from '../src/db/schema';
import { createTestApp, seed } from './helpers/app';
import { pj } from './helpers/fixtures';

let t: Awaited<ReturnType<typeof createTestApp>>;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  t = await createTestApp();
  s = await seed(t.app, t.db);
  await t.app.inject({ method: 'POST', url: '/api/partner/plans', headers: { cookie: s.gerenteA }, payload: { name: 'Bronze', frequencyLevel: 'low' } });
  const off = await t.app.inject({ method: 'POST', url: '/api/partner/plans', headers: { cookie: s.gerenteA }, payload: { name: 'Antigo', frequencyLevel: 'medium' } });
  await t.app.inject({ method: 'PATCH', url: `/api/partner/plans/${off.json().plan.id}`, headers: { cookie: s.gerenteA }, payload: { active: false } });
});
afterAll(() => t.close());

describe('public partner page', () => {
  it('shows name and only active plans', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/public/partners/parceiro-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json().partner).toEqual({ name: 'Parceiro parceiro-a', slug: 'parceiro-a' });
    expect(res.json().plans.map((p: { name: string }) => p.name)).toEqual(['Bronze']);
    expect(res.json().plans[0].partnerId).toBeUndefined();
  });

  it('is 404 for unknown or inactive partners', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/public/partners/nao-existe' })).statusCode).toBe(404);
    await t.db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, s.partnerB.id));
    expect((await t.app.inject({ method: 'GET', url: '/api/public/partners/parceiro-b' })).statusCode).toBe(404);
  });
});

describe('advertiser self-signup', () => {
  const body = { companyName: 'Loja Fit', contactName: 'Bia', email: 'Bia@LojaFit.com', password: 'senha-loja-1', personType: 'pf', document: '529.982.247-25' };

  it('creates advertiser and user, and signs in', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'bia@lojafit.com', role: 'advertiser', partnerId: s.partnerA.id });
    const cookie = res.cookies.find((c) => c.name === 'kraken_session')!;
    const me = await t.app.inject({ method: 'GET', url: '/api/advertiser', headers: { cookie: `kraken_session=${cookie.value}` } });
    expect(me.json().advertiser).toMatchObject({ name: 'Loja Fit', source: 'self_signup', email: 'bia@lojafit.com', personType: 'pf', document: '52998224725' });
    const list = await t.app.inject({ method: 'GET', url: '/api/partner/advertisers', headers: { cookie: s.gerenteA } });
    expect(list.json().advertisers.map((a: { name: string }) => a.name)).toContain('Loja Fit');
  });

  it('rejects duplicate e-mail, weak password and unknown partner', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, ...pj() } })).json())
      .toEqual({ error: 'email_taken' });
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, email: 'novo@y.com' } })).json())
      .toEqual({ error: 'document_taken' });
    const bad = await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, email: 'w@y.com', document: '52998224724' }, remoteAddress: '10.0.0.2' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_document');
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, email: 'v@y.com', document: undefined }, remoteAddress: '10.0.0.2' })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, ...pj(), email: 'x@y.com', password: '123' } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'POST', url: '/api/public/partners/nao-existe/advertisers', payload: { ...body, ...pj(), email: 'z@y.com' } })).statusCode).toBe(404);
  });

  it('advertiser cannot use partner routes', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/public/partners/parceiro-a/advertisers', payload: { ...body, ...pj(), email: 'c@lojafit.com' }, remoteAddress: '10.0.0.3' });
    const cookie = `kraken_session=${res.cookies.find((c) => c.name === 'kraken_session')!.value}`;
    expect((await t.app.inject({ method: 'GET', url: '/api/partner/advertisers', headers: { cookie } })).statusCode).toBe(403);
  });
});
